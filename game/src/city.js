// Solmar — the city of "Palkon Auto", generated deterministically from one seed.
// Pure data: no DOM, no WebGL. Node (layout verifier) and the browser share it.
// Coordinates: x east 0..3840, z south 0..3456, y up. Boulevard x=400 north-south.
import { createRandom, pick, range, rangeInt } from './rng.js';

export const SEED = 20261123;
export const CITY_W = 3840;
export const CITY_H = 3456;

export const DISTRICTS = [
  { id: 'old', name: 'Old Solmar', tagline: 'Crooked lanes, old money', standing: 61,
    wall: ['#c98f5f', '#b57a4e', '#d9a06b'], roof: '#8a4a34', glass: false },
  { id: 'glass', name: 'Glasspoint', tagline: 'Towers that catch the sun', standing: 44,
    wall: ['#7fa8b8', '#6d9aad', '#8fb4c2'], roof: '#4a6a78', glass: true },
  { id: 'citrus', name: 'Citrus Quarter', tagline: 'Orange walls, loud mornings', standing: 72,
    wall: ['#e8c46a', '#dfb45a', '#ecd184'], roof: '#a8542e', glass: false },
  { id: 'market', name: 'South Market', tagline: 'Everything has a price', standing: 58,
    wall: ['#d77f69', '#c96a55', '#e08d77'], roof: '#6e3a2e', glass: false },
  { id: 'canal', name: 'Canal Ward', tagline: 'Water under every bridge', standing: 67,
    wall: ['#398e99', '#2f7d88', '#4ba3ad'], roof: '#2c4a52', glass: false },
  { id: 'marina', name: 'Pearl Marina', tagline: 'Boats, salt, and deals', standing: 53,
    wall: ['#bcd6de', '#a9c8d2', '#cfe0e6'], roof: '#37505c', glass: false },
  { id: 'beach', name: 'Sunstrand Beach', tagline: 'Sand at the edge of town', standing: 81,
    wall: ['#ead8b2', '#e0cda0', '#f2e2c0'], roof: '#b98a5a', glass: false },
];

export function districtAt(x, z) {
  if (x < 432) return DISTRICTS[0]; // Old Solmar, west of the boulevard
  if (x >= 3520) return DISTRICTS[6]; // Sunstrand Beach, east edge
  if (x >= 3050 && z >= 2350 && z <= 2950) return DISTRICTS[5]; // Pearl Marina / harbour
  if (z >= 2400 && z <= 2800 && x >= 1000) return DISTRICTS[4]; // Canal Ward
  if (z >= 2900) return DISTRICTS[3]; // South Market
  if (x < 1600 && z < 1700) return DISTRICTS[1]; // Glasspoint
  return DISTRICTS[2]; // Citrus Quarter
}

// Diagonal avenue through Old Solmar: from (60,240) to (360,1500).
export function oldAvenueX(z) {
  return 60 + (300 / 1260) * (z - 240);
}

export function generateCity(seed) {
  const rng = createRandom(seed);
  const roads = [];
  const buildings = [];
  const cars = [];
  const peds = [];
  const trees = [];
  const lamps = [];
  const boats = [];
  const lights = [];
  const signs = [];
  const benches = [];
  const bins = [];

  const road = (x0, z0, x1, z1, kind) => roads.push({ x0, z0, x1, z1, kind });

  // --- Road hierarchy: one wide boulevard, narrower secondaries, narrowest locals.
  road(368, 0, 432, CITY_H, 'boulevard'); // x=400, width 64
  road(0, 1704, CITY_W, 1752, 'avenue'); // cross avenue z=1728, width 48
  const vSec = [760, 1120, 1520, 1960, 2400, 2840, 3240];
  const vLoc = [940, 1300, 1750, 2150, 2620, 3050];
  const hSec = [320, 720, 1080, 1440, 2080, 2400, 2900, 3200];
  const hLoc = [520, 900, 1260, 1900, 2260, 3050];
  for (const x of vSec) road(x - 14, 0, x + 14, CITY_H, 'secondary');
  for (const x of vLoc) road(x - 9, 0, x + 9, CITY_H, 'local');
  for (const z of hSec) road(432, z - 14, CITY_W, z + 14, 'secondary');
  for (const z of hLoc) road(432, z - 9, CITY_W, z + 9, 'local');
  // Diagonal avenue (Old Solmar) as small AABB segments so the verifier can test it.
  for (let t = 0; t < 1; t += 0.05) {
    const z = 240 + t * 1260;
    const x = oldAvenueX(z);
    road(x - 34, z - 34, x + 34, z + 34, 'diagonal');
  }
  // Canal bridges: three drivable crossings.
  for (const x of [1500, 2200, 3000]) road(x - 14, 2540, x + 14, 2660, 'bridge');

  const plaza = { x0: 300, z0: 1628, x1: 500, z1: 1828 };
  const park = { x0: 2200, z0: 520, x1: 2620, z1: 900 };
  const harbour = { x0: 3240, z0: 2400, x1: CITY_W, z1: 2900 };
  const beach = { x0: 3520, z0: 0, x1: CITY_W, z1: 2400 };
  const canal = { x0: 1200, z0: 2570, x1: CITY_W, z1: 2630 };
  const marinaPlot = { x0: 3290, z0: 2290, x1: 3370, z1: 2370 }; // hotel forecourt by the harbour

  const rectHit = (a, b, m = 0) =>
    a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;

  // --- Planned blocks: cells between street centrelines, minus plaza/park/harbour/beach.
  const vGap = [[432, 746], [774, 926], [958, 1106], [1134, 1286], [1318, 1506], [1538, 1736],
    [1768, 1946], [1978, 2136], [2168, 2386], [2418, 2606], [2638, 2826], [2858, 3036],
    [3068, 3226], [3258, 3506]];
  const hGap = [[0, 306], [334, 506], [538, 706], [738, 886], [918, 1066], [1098, 1246],
    [1278, 1426], [1458, 1704], [1752, 1886], [1918, 2066], [2098, 2246], [2278, 2386],
    [2418, 2556], [2644, 2886], [2918, 3036], [3068, 3186], [3218, 3456]];

  function addBuilding(x0, z0, x1, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const d = districtAt(cx, cz);
    let h;
    if (d.id === 'glass') h = range(rng, 42, 128);
    else if (d.id === 'old') h = range(rng, 10, 28);
    else if (d.id === 'beach') h = range(rng, 8, 20);
    else if (d.id === 'market') h = range(rng, 12, 32);
    else if (d.id === 'citrus') h = range(rng, 15, 52);
    else if (d.id === 'canal') h = range(rng, 12, 38);
    else h = range(rng, 15, 46);
    if (x0 < 760) h += 26; // tallest buildings line the boulevard
    h = Math.min(130, h);
    const style = d.glass && rng() < 0.8 ? 'glass' : (rng() < 0.55 ? 'brick' : 'plaster');
    buildings.push({
      x0, z0, x1, z1, h, district: d.id, style,
      wall: pick(rng, d.wall), roof: d.roof,
    });
  }

  for (const [vx0, vx1] of vGap) {
    for (const [hz0, hz1] of hGap) {
      const block = { x0: vx0, z0: hz0, x1: vx1, z1: hz1 };
      if (rectHit(block, plaza, 0) || rectHit(block, park, 0) || rectHit(block, harbour, 0)) continue;
      if (rectHit(block, marinaPlot, 0)) continue; // marina hotel forecourt stays open
      if (block.x0 >= 3506) continue; // beach strip, no buildings
      if (block.z0 >= 2556 && block.z1 <= 2644) continue; // canal
      // Leave the bridge approaches open: no buildings beside a bridge on either bank.
      if (block.z1 > 2520 && block.z0 < 2680 && [1500, 2200, 3000].some(bx => block.x0 < bx + 24 && block.x1 > bx - 24)) continue;
      const w = vx1 - vx0, h = hz1 - hz0;
      const m = 7; // sidewalk margin inside the block
      const ix0 = vx0 + m, iz0 = hz0 + m, ix1 = vx1 - m, iz1 = hz1 - m;
      const cols = w > 280 ? 3 : w > 140 ? 2 : 1;
      const rows = h > 170 ? 2 : 1;
      const cw = (ix1 - ix0 - (cols - 1) * 10) / cols;
      const ch = (iz1 - iz0 - (rows - 1) * 10) / rows;
      for (let ci = 0; ci < cols; ci += 1) {
        for (let ri = 0; ri < rows; ri += 1) {
          addBuilding(ix0 + ci * (cw + 10), iz0 + ri * (ch + 10),
            ix0 + ci * (cw + 10) + cw, iz0 + ri * (ch + 10) + ch);
        }
      }
    }
  }

  // --- Old Solmar: staggered rows flanking the diagonal avenue (off-grid, never a grid).
  // The avenue runs z 240..1500; south of the plaza the quarter continues in fixed
  // staggered columns, never extrapolated across the boulevard.
  for (let z = 300; z <= 1500; z += 170) {
    const ax = oldAvenueX(z);
    const jz = z + range(rng, -20, 20);
    const w1 = range(rng, 30, 50), d1 = range(rng, 28, 42);
    const bx0 = ax - 58 - w1;
    if (bx0 > 8) addBuilding(bx0, jz - d1 / 2, bx0 + w1, jz + d1 / 2);
    const w2 = range(rng, 30, 48), d2 = range(rng, 28, 42);
    const cx0 = ax + 58;
    if (cx0 + w2 < 360) addBuilding(cx0, jz - d2 / 2, cx0 + w2, jz + d2 / 2);
  }
  for (let z = 1950; z <= 3300; z += 170) {
    const jz = z + range(rng, -24, 24);
    if (jz > 3380) continue;
    const w1 = range(rng, 34, 56), d1 = range(rng, 30, 48);
    const bx0 = range(rng, 16, 120);
    addBuilding(bx0, jz - d1 / 2, bx0 + w1, jz + d1 / 2);
    const w2 = range(rng, 34, 52), d2 = range(rng, 30, 46);
    const cx0 = range(rng, 210, 300);
    if (cx0 + w2 < 360) addBuilding(cx0, jz - d2 / 2, cx0 + w2, jz + d2 / 2);
  }

  // --- Beach huts on Sunstrand Beach, tucked between the east-west roads.
  for (const z of [420, 620, 820, 1000, 1160, 1350, 1550, 1800, 1980, 2150, 2320, 2480]) {
    addBuilding(3550, z - 8, 3590, z + 8);
  }

  // --- Landmarks: clock tower + fountain on the plaza, tallest Glasspoint tower, marina hotel.
  const tower = { x: 400, z: 1728, h: 96 };
  buildings.push({ x0: 388, z0: 1716, x1: 412, z1: 1740, h: 96, district: 'old', style: 'brick', wall: '#c98f5f', roof: '#8a4a34', landmark: 'tower' });
  const tallest = buildings.filter(b => b.district === 'glass').sort((a, b) => b.h - a.h)[0];
  if (tallest) tallest.landmark = 'glasspoint';
  buildings.push({ x0: 3300, z0: 2300, x1: 3360, z1: 2360, h: 72, district: 'marina', style: 'plaster', wall: '#bcd6de', roof: '#37505c', landmark: 'marina' });
  const citrusHall = buildings.find(b => b.district === 'citrus' && b.x1 - b.x0 > 60);
  if (citrusHall) citrusHall.landmark = 'citrus';

  signs.push(
    { x: 400, y: 78, z: 1741, w: 30, h: 9, text: 'SOLMAR', face: 's', color: '#ffd28a' },
    { x: (tallest.x0 + tallest.x1) / 2, y: tallest.h - 6, z: tallest.z1 + 0.4, w: 44, h: 8, text: 'GLASSPOINT', face: 's', color: '#8fe3ff' },
    { x: 3330, y: 58, z: 2361, w: 34, h: 8, text: 'MARINA', face: 's', color: '#9fe8d8' },
    { x: (citrusHall.x0 + citrusHall.x1) / 2, y: citrusHall.h - 4, z: citrusHall.z1 + 0.4, w: 30, h: 7, text: 'CITRUS', face: 's', color: '#ffb35c' },
  );

  // --- Cars: 54 parked (boulevard curbs), 8 drivable, 40 traffic (3 yellow taxis).
  // Every car is drawn by the same dynamic-mesh pass; none is ever skipped.
  const carColors = ['#c23b2e', '#2e5f8a', '#d8d8d8', '#3a3f45', '#7a4a8a', '#2f7d5a', '#b8b0a0', '#8a2f2f'];
  for (let i = 0; i < 27; i += 1) {
    const z = 120 + i * 125;
    cars.push({ x: 373, z, yaw: i % 2 === 0 ? 0 : Math.PI, kind: 'parked', color: carColors[i % carColors.length], taxi: false });
    cars.push({ x: 427, z: z + 60, yaw: i % 2 === 0 ? Math.PI : 0, kind: 'parked', color: carColors[(i + 3) % carColors.length], taxi: false });
  }
  const drivableSpots = [[400, 1500, 0], [400, 1560, 0], [396, 1900, Math.PI], [404, 1960, Math.PI],
    [250, 1728, Math.PI / 2], [520, 1728, Math.PI / 2], [700, 1728, -Math.PI / 2], [900, 1728, Math.PI / 2]];
  for (const [x, z, yaw] of drivableSpots) {
    cars.push({ x, z, yaw, kind: 'drivable', color: '#d77f69', taxi: false });
  }
  const driveRoads = [
    { x0: 368, z0: 0, x1: 432, z1: CITY_H, axis: 'z' },
    { x0: 0, z0: 1704, x1: CITY_W, z1: 1752, axis: 'x' },
    ...vSec.map(x => ({ x0: x - 14, z0: 0, x1: x + 14, z1: CITY_H, axis: 'z' })),
    ...hSec.map(z => ({ x0: 432, z0: z - 14, x1: CITY_W, z1: z + 14, axis: 'x' })),
  ];
  for (let i = 0; i < 40; i += 1) {
    const r = pick(rng, driveRoads);
    let x, z, yaw;
    if (r.axis === 'z') { x = (r.x0 + r.x1) / 2 + (rng() < 0.5 ? -7 : 7); z = range(rng, 60, CITY_H - 60); yaw = rng() < 0.5 ? 0 : Math.PI; }
    else { z = (r.z0 + r.z1) / 2 + (rng() < 0.5 ? -7 : 7); x = range(rng, 500, CITY_W - 60); yaw = rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2; }
    const taxi = i < 3;
    cars.push({ x, z, yaw, kind: 'traffic', color: taxi ? '#f2c200' : carColors[i % carColors.length], taxi });
  }

  // --- Pedestrians in bright jackets: plaza, park, canal promenade, boulevard sidewalks.
  const jackets = ['#e33b2f', '#f2c200', '#2f9e5f', '#2e6fd8', '#ff7a1a', '#e05aa0'];
  const pedSpots = [];
  for (let i = 0; i < 10; i += 1) pedSpots.push([range(rng, 320, 480), range(rng, 1650, 1810)]);
  for (let i = 0; i < 10; i += 1) pedSpots.push([range(rng, 2230, 2590), range(rng, 550, 870)]);
  for (let i = 0; i < 10; i += 1) pedSpots.push([range(rng, 1300, 3200), rng() < 0.5 ? range(rng, 2540, 2560) : range(rng, 2640, 2660)]);
  for (let i = 0; i < 10; i += 1) pedSpots.push([rng() < 0.5 ? range(rng, 348, 362) : range(rng, 438, 452), range(rng, 100, 3400)]);
  for (const [x, z] of pedSpots) peds.push({ x, z, yaw: range(rng, 0, Math.PI * 2), jacket: pick(rng, jackets) });

  // --- Trees: boulevard rows, cross avenue, park, promenade, plaza corners, beach.
  for (let z = 100; z <= 3400; z += 100) { trees.push({ x: 352, z, s: range(rng, 0.9, 1.3) }); trees.push({ x: 448, z, s: range(rng, 0.9, 1.3) }); }
  for (let x = 560; x <= 3800; x += 140) { trees.push({ x, z: 1692, s: range(rng, 0.9, 1.3) }); trees.push({ x, z: 1764, s: range(rng, 0.9, 1.3) }); }
  for (let i = 0; i < 40; i += 1) trees.push({ x: range(rng, 2220, 2600), z: range(rng, 540, 880), s: range(rng, 0.9, 1.4) });
  for (let x = 1300; x <= 3200; x += 160) { trees.push({ x, z: 2552, s: range(rng, 0.9, 1.2) }); trees.push({ x, z: 2648, s: range(rng, 0.9, 1.2) }); }
  for (const [x, z] of [[320, 1650], [480, 1650], [320, 1806], [480, 1806], [330, 1728], [470, 1728], [400, 1648], [400, 1808]]) trees.push({ x, z, s: 1.1 });
  for (let z = 120; z <= 2280; z += 180) trees.push({ x: 3500, z, s: range(rng, 0.9, 1.2) });

  // --- Street lamps: boulevard, cross avenue, two secondaries, park, promenade = 140.
  for (let z = 80; z <= 3400; z += 160) { lamps.push({ x: 360, z }); lamps.push({ x: 440, z }); }
  for (let x = 560; x <= 3800; x += 160) { lamps.push({ x, z: 1696 }); lamps.push({ x, z: 1760 }); }
  for (let z = 100; z <= 3300; z += 200) { lamps.push({ x: 1112, z }); lamps.push({ x: 2392, z }); }
  for (const [x, z] of [[2260, 580], [2560, 580], [2260, 840], [2560, 840], [1400, 2556], [2000, 2556], [2600, 2556], [3200, 2556]]) lamps.push({ x, z });
  for (let x = 1400; x <= 3200; x += 300) lamps.push({ x, z: 2648 });
  for (const [x, z] of [[320, 1650], [480, 1650], [320, 1806], [480, 1806], [400, 1640], [400, 1816], [330, 1728]]) lamps.push({ x, z });

  // --- Traffic lights at 13 intersections: 8 on the boulevard, 5 on the cross avenue.
  for (const z of [320, 720, 1080, 1440, 2080, 2400, 2900, 3200]) lights.push({ x: 436, z: z - 18 });
  for (const x of [760, 1120, 1960, 2840, 3240]) lights.push({ x: x + 18, z: 1700 });

  // --- Boats: 3 in the harbour, 2 on the canal.
  boats.push({ x: 3350, z: 2500, yaw: 0.4, len: 22 }, { x: 3520, z: 2720, yaw: -0.3, len: 26 },
    { x: 3680, z: 2560, yaw: 1.1, len: 18 }, { x: 1800, z: 2600, yaw: Math.PI / 2, len: 16 },
    { x: 2600, z: 2600, yaw: Math.PI / 2, len: 16 });

  // --- Benches + bins along the canal promenade, clear of the walking line.
  for (let x = 1400; x <= 3100; x += 240) {
    benches.push({ x, z: 2546, yaw: 0 });
    bins.push({ x: x + 40, z: 2546 });
  }

  return {
    seed, roads, buildings, cars, peds, trees, lamps, boats, lights, signs,
    benches, bins, plaza, park, harbour, beach, canal, tower,
    fountain: { x: 452, z: 1680, r: 14 },
  };
}

// Layout verifier: every problem is a string; empty list means the city is clean.
export function layoutCheck(city) {
  const problems = [];
  const counts = {
    buildings: city.buildings.length,
    cars: city.cars.length,
    parked: city.cars.filter(c => c.kind === 'parked').length,
    drivable: city.cars.filter(c => c.kind === 'drivable').length,
    traffic: city.cars.filter(c => c.kind === 'traffic').length,
    taxis: city.cars.filter(c => c.taxi).length,
    peds: city.peds.length,
    trees: city.trees.length,
    lamps: city.lamps.length,
    boats: city.boats.length,
    lights: city.lights.length,
    signs: city.signs.length,
    benches: city.benches.length,
    bins: city.bins.length,
  };
  const rectHit = (a, b, m = 0) =>
    a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;

  // Buildings must not sit on a road (4 m margin) and must not overlap each other.
  // Exception: the clock tower stands on the plaza where boulevard meets cross avenue.
  for (let i = 0; i < city.buildings.length; i += 1) {
    const b = city.buildings[i];
    if (b.x1 - b.x0 < 8 || b.z1 - b.z0 < 8) problems.push(`building ${i} too small`);
    if (b.landmark === 'tower') continue;
    for (const r of city.roads) {
      if (rectHit(b, r, 4)) { problems.push(`building ${i} overlaps road ${r.kind} at ${Math.round(b.x0)},${Math.round(b.z0)}`); break; }
    }
  }
  for (let i = 0; i < city.buildings.length; i += 1) {
    for (let j = i + 1; j < city.buildings.length; j += 1) {
      if (rectHit(city.buildings[i], city.buildings[j], 0)) {
        problems.push(`buildings ${i} and ${j} overlap`);
        break;
      }
    }
  }
  // The clock tower must stand inside the plaza; the fountain must not hit it.
  if (!rectHit(city.plaza, { x0: 388, z0: 1716, x1: 412, z1: 1740 })) problems.push('clock tower not in plaza');
  const f = city.fountain;
  if (Math.hypot(f.x - 400, f.z - 1728) < 30) problems.push('fountain too close to clock tower');
  // Every car must sit on (or at the curb of) a road.
  for (let i = 0; i < city.cars.length; i += 1) {
    const c = city.cars[i];
    const onRoad = city.roads.some(r => c.x >= r.x0 - 10 && c.x <= r.x1 + 10 && c.z >= r.z0 - 10 && c.z <= r.z1 + 10);
    if (!onRoad) problems.push(`car ${i} (${c.kind}) off road at ${Math.round(c.x)},${Math.round(c.z)}`);
  }
  // Three bridges must cross the canal.
  const bridges = city.roads.filter(r => r.kind === 'bridge');
  if (bridges.length !== 3) problems.push(`expected 3 bridges, got ${bridges.length}`);
  for (const b of bridges) {
    if (!(b.z0 < city.canal.z0 && b.z1 > city.canal.z1)) problems.push('bridge does not span the canal');
  }
  // Expected counts.
  const expect = { buildings: 500, parked: 54, drivable: 8, traffic: 40, taxis: 3, peds: 40, boats: 5, lights: 13, signs: 4 };
  for (const [k, min] of Object.entries(expect)) {
    if (counts[k] < min) problems.push(`${k}: ${counts[k]} < ${min}`);
  }
  if (counts.trees < 175) problems.push(`trees: ${counts.trees} < 175`);
  if (counts.lamps !== 140) problems.push(`lamps: ${counts.lamps} != 140`);
  // Districts: all seven must have buildings.
  const seen = new Set(city.buildings.map(b => b.district));
  for (const d of DISTRICTS) if (!seen.has(d.id)) problems.push(`district ${d.id} has no buildings`);
  return { problems, counts };
}
