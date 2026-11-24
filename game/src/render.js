// Handwritten WebGL 2 renderer for "Palkon Auto" — one shader program, one merged
// vertex buffer for the whole city, one dynamic buffer for every car, one sky buffer
// for sun/moon/stars. No vendored engine, no network requests.
import { createRandom, hexRgb, shade } from './rng.js';
import { CITY_W, CITY_H } from './city.js';

export const PRESETS = {
  midday: { name: 'Midday', sky: '#aecfdd', fog: '#c8d8e2', fogDen: 0.00016,
    lightDir: [0.25, -0.92, 0.3], lightCol: [1.0, 0.96, 0.88], amb: [0.55, 0.55, 0.55],
    emi: 0.35, sunI: 1, moonI: 0, starI: 0 },
  sunset: { name: 'Sunset', sky: '#dd7a45', fog: '#e8a06a', fogDen: 0.00022,
    lightDir: [0.45, -0.16, 0.88], lightCol: [1.0, 0.55, 0.28], amb: [0.46, 0.4, 0.38],
    emi: 0.7, sunI: 1, moonI: 0, starI: 0 },
  night: { name: 'Night', sky: '#0b1526', fog: '#0e1a2c', fogDen: 0.00028,
    lightDir: [0.18, -0.36, 0.92], lightCol: [0.45, 0.55, 0.75], amb: [0.16, 0.18, 0.24],
    emi: 1.0, sunI: 0, moonI: 1, starI: 1 },
};

const VERT = `#version 300 es
precision highp float;
in vec3 aPos; in vec3 aNor; in vec3 aCol; in vec3 aEmi; in vec2 aUV; in vec4 aMisc;
uniform mat4 uProj; uniform mat4 uView; uniform vec3 uCamPos;
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform vec3 uAmb;
uniform vec3 uFogCol; uniform float uFogDen; uniform float uEmiBoost;
uniform float uSunI; uniform float uMoonI; uniform float uStarI;
uniform vec3 uSunDir; uniform vec3 uMoonDir;
out vec3 vCol; out vec3 vEmi; out vec2 vUV; out vec4 vMisc; out float vFog;
void main(){
  vec3 wp = aPos;
  if (aMisc.w > 0.5) {
    // Sky bodies ride with the camera. Sun/moon are disc fans built around their
    // direction (aPos = unit-circle local coords); stars are tiny quads whose
    // direction rides in aNor and whose corner offset rides in aPos.
    vec3 dir; float base;
    if (aEmi.x > 0.5) { dir = uSunDir; base = 34.0; }
    else if (aEmi.y > 0.5) { dir = uMoonDir; base = 26.0; }
    else { dir = aNor; base = 2.0; }
    vec3 up = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(dir, up));
    vec3 upv = cross(right, dir);
    // aUV.y is a per-vertex depth push (the halo sits a few metres behind the disc
    // so the two coplanar fans never z-fight into a moire).
    wp = uCamPos + dir * (900.0 + aUV.y) + (right * aPos.x + upv * aPos.y) * base * max(aMisc.z, 0.001);
  }
  vec4 vp = uView * vec4(wp, 1.0);
  gl_Position = uProj * vp;
  float depth = max(-vp.z, 0.0);
  if (aMisc.w > 0.5) {
    vFog = 0.0;
    float k = aEmi.x * uSunI + aEmi.y * uMoonI + aEmi.z * uStarI;
    if (k < 0.01) gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // invisible body: clip it, never a black square
    vCol = aCol * k;
    vEmi = vec3(0.0);
  } else {
    vFog = (aMisc.y > 0.5) ? 0.0 : 1.0 - exp(-uFogDen * uFogDen * depth * depth);
    vec3 n = normalize(aNor);
    float diff = max(dot(n, -uLightDir), 0.0);
    vec3 hv = normalize(-uLightDir + normalize(uCamPos - wp));
    float spec = pow(max(dot(n, hv), 0.0), 40.0) * aMisc.z;
    vCol = aCol * (uAmb + uLightCol * diff) + uLightCol * spec;
    if (aMisc.y > 0.5) vCol = aCol;
    vEmi = aEmi * uEmiBoost;
  }
  vUV = aUV; vMisc = aMisc;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vCol; in vec3 vEmi; in vec2 vUV; in vec4 vMisc; in float vFog;
uniform vec3 uFogCol; uniform sampler2D uTex;
out vec4 outCol;
void main(){
  vec3 c = vCol;
  if (vMisc.x > 0.5) {
    vec3 t = texture(uTex, vUV).rgb;
    c = t * 1.15 + vCol * 0.15;
  }
  c = mix(c, uFogCol, clamp(vFog, 0.0, 1.0));
  c += vEmi;
  outCol = vec4(c, 1.0);
}`;

// One vertex = 18 floats: pos(3) nor(3) col(3) emi(3) uv(2) misc(4: texUse, unlit, spec, sky).
// With a capacity the mesh writes into a preallocated Float32Array (dynamic pass, reused
// every frame); without one it accumulates a JS array (static build, converted once).
class Mesh {
  constructor(capacity = 0) {
    if (capacity > 0) { this.buf = new Float32Array(capacity); this.cur = 0; this.a = null; }
    else { this.a = []; this.n = 0; }
    this.n = 0;
  }
  reset() { if (this.buf) this.cur = 0; else this.a.length = 0; this.n = 0; }
  v(x, y, z, nx, ny, nz, c, e, u, v, tex, unlit, spec, sky) {
    if (this.buf) {
      const o = this.cur, b = this.buf;
      b[o] = x; b[o + 1] = y; b[o + 2] = z; b[o + 3] = nx; b[o + 4] = ny; b[o + 5] = nz;
      b[o + 6] = c[0]; b[o + 7] = c[1]; b[o + 8] = c[2];
      b[o + 9] = e[0]; b[o + 10] = e[1]; b[o + 11] = e[2];
      b[o + 12] = u; b[o + 13] = v; b[o + 14] = tex; b[o + 15] = unlit; b[o + 16] = spec; b[o + 17] = sky;
      this.cur += 18;
    } else {
      this.a.push(x, y, z, nx, ny, nz, c[0], c[1], c[2], e[0], e[1], e[2], u, v, tex, unlit, spec, sky);
    }
    this.n += 1;
  }
  tri(p0, p1, p2, n, c, e = [0, 0, 0], o = {}) {
    for (const p of [p0, p1, p2]) this.v(p[0], p[1], p[2], n[0], n[1], n[2], c, e, 0, 0, o.tex || 0, o.unlit || 0, o.spec || 0, o.sky || 0);
  }
  quad(p0, p1, p2, p3, n, c, e = [0, 0, 0], o = {}) {
    // p0..p3 corners; uv corners only used for textured quads.
    const uvs = o.uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const pts = [p0, p1, p2, p0, p2, p3];
    const uv = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]];
    for (let i = 0; i < 6; i += 1) {
      const p = pts[i];
      this.v(p[0], p[1], p[2], n[0], n[1], n[2], c, e, uv[i][0], uv[i][1], o.tex || 0, o.unlit || 0, o.spec || 0, o.sky || 0);
    }
  }
  // Axis-aligned-ish box centred at (cx,cy,cz), size (sx,sy,sz), rotated by yaw around Y.
  box(cx, cy, cz, sx, sy, sz, yaw, col, o = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rot = (x, z) => [cx + x * c + z * s, cz - x * s + z * c];
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const top = o.top || col;
    const emi = o.emi || [0, 0, 0];
    const spec = o.spec || 0;
    const faces = [
      { n: [0, 1, 0], col: top, pts: [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, -1, 0], col, pts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]] },
      { n: [0, 0, 1], col, pts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], col, pts: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
      { n: [1, 0, 0], col, pts: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      { n: [-1, 0, 0], col, pts: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    ];
    for (const f of faces) {
      const n = [f.n[0] * c + f.n[2] * s, f.n[1], -f.n[0] * s + f.n[2] * c];
      const pts = f.pts.map(([x, y, z]) => { const [rx, rz] = rot(x, z); return [rx, cy + y, rz]; });
      this.quad(pts[0], pts[1], pts[2], pts[3], n, f.col, emi, { spec });
    }
  }
  // Flat ground quad for a rect at height y.
  ground(x0, z0, x1, z1, y, col, o = {}) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], col, o.emi || [0, 0, 0], { spec: o.spec || 0 });
  }
  toArray() { return this.a ? new Float32Array(this.a) : this.buf.subarray(0, this.cur); }
  get count() { return this.n; }
}

function buildSignAtlas(signs) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#101418'; g.fillRect(0, 0, 1024, 256);
  const rows = {};
  signs.forEach((sg, i) => {
    const y0 = i * 64;
    // Uploaded with UNPACK_FLIP_Y_WEBGL, so canvas row i (from the top) sits at
    // v in [1-(i+1)/4, 1-i/4]; the quad's bottom edge takes the lower v.
    rows[sg.text] = { v0: 1 - (i + 1) / 4, v1: 1 - i / 4 };
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = sg.color; g.shadowBlur = 18;
    g.fillStyle = sg.color;
    g.fillText(sg.text, 512, y0 + 32);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.fillText(sg.text, 512, y0 + 32);
  });
  return { canvas, rows };
}

export function buildStatic(city) {
  const rng = createRandom(city.seed + 7);
  const m = new Mesh();
  const atlas = buildSignAtlas(city.signs);

  // Ground base, then every ground layer slightly higher so depth resolves cleanly.
  m.ground(0, 0, CITY_W, CITY_H, 0, hexRgb('#a8a88e'));
  m.ground(city.park.x0, city.park.z0, city.park.x1, city.park.z1, 0.05, hexRgb('#56856b'));
  m.ground(city.beach.x0, city.beach.z0, city.beach.x1, city.beach.z1, 0.05, hexRgb('#e8d9a8'));
  m.ground(3760, 0, CITY_W, 2400, 0.15, hexRgb('#2f7d8a'), { spec: 0.9 });
  m.ground(city.canal.x0, city.canal.z0, city.canal.x1, city.canal.z1, 0.15, hexRgb('#2f7d8a'), { spec: 0.9 });
  m.ground(city.harbour.x0, city.harbour.z0, city.harbour.x1, city.harbour.z1, 0.15, hexRgb('#2f7d8a'), { spec: 0.9 });
  m.ground(city.plaza.x0, city.plaza.z0, city.plaza.x1, city.plaza.z1, 0.08, hexRgb('#cbb98f'));
  for (const r of city.roads) {
    const deck = r.kind === 'bridge' ? 0.3 : 0.06;
    m.ground(r.x0, r.z0, r.x1, r.z1, deck, hexRgb('#33383e'));
  }
  // Sidewalks: a pale frame under every planned block.
  for (const b of city.buildings) {
    if (b.landmark === 'tower') continue;
    m.ground(b.x0 - 5, b.z0 - 5, b.x1 + 5, b.z1 + 5, 0.04, hexRgb('#cfc4a8'));
  }
  // Boulevard centre dashes + crosswalk stripes by the plaza.
  for (let z = 20; z < CITY_H; z += 14) m.ground(399.7, z, 400.3, z + 6, 0.09, hexRgb('#d8d8d8'));
  for (let x = 20; x < CITY_W; x += 14) m.ground(x, 1727.7, x + 6, 1728.3, 0.09, hexRgb('#d8d8d8'));
  for (let i = 0; i < 6; i += 1) {
    m.ground(372 + i * 10, 1700, 378 + i * 10, 1704, 0.09, hexRgb('#e8e8e8'));
    m.ground(372 + i * 10, 1752, 378 + i * 10, 1756, 0.09, hexRgb('#e8e8e8'));
  }

  // Buildings: brick with real windows, glass with day glare / night lit interiors.
  for (const b of city.buildings) {
    const wall = shade(hexRgb(b.wall), rng, 0.12);
    const roof = shade(hexRgb(b.roof), rng, 0.1);
    const glass = b.style === 'glass';
    m.box((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.h, b.z1 - b.z0, 0, wall,
      { top: roof, spec: glass ? 0.7 : 0.05 });
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const floors = Math.max(1, Math.min(9, Math.floor(b.h / 11)));
    const colsNS = Math.max(1, Math.min(6, Math.floor(w / 13)));
    const colsEW = Math.max(1, Math.min(6, Math.floor(d / 13)));
    const winW = glass ? 8 : 5, winH = glass ? 9 : 7;
    let made = 0;
    const win = (cx, cy, cz, nx, nz) => {
      if (made >= 40) return;
      const lit = rng() < 0.55;
      const col = glass ? hexRgb('#9fc4d8') : hexRgb('#20262e');
      const emi = lit ? [0.85, 0.6, 0.3] : [0, 0, 0];
      const hw = winW / 2, hh = winH / 2, off = 0.14;
      const spec = glass ? 0.9 : 0.1;
      if (nz !== 0) {
        const z = cz + nz * off;
        m.quad([cx - hw, cy - hh, z], [cx + hw, cy - hh, z], [cx + hw, cy + hh, z], [cx - hw, cy + hh, z],
          [0, 0, nz], col, emi, { spec });
      } else {
        const x = cx + nx * off;
        m.quad([x, cy - hh, cz - hw], [x, cy - hh, cz + hw], [x, cy + hh, cz + hw], [x, cy + hh, cz - hw],
          [nx, 0, 0], col, emi, { spec });
      }
      made += 1;
    };
    for (let f = 0; f < floors && made < 40; f += 1) {
      const y = 4 + f * 11;
      if (y + winH > b.h - 2) break;
      for (let c = 0; c < colsNS && made < 40; c += 1) {
        const x = b.x0 + (c + 0.5) * (w / colsNS);
        win(x, y, b.z1, 0, 1); win(x, y, b.z0, 0, -1);
      }
      for (let c = 0; c < colsEW && made < 40; c += 1) {
        const z = b.z0 + (c + 0.5) * (d / colsEW);
        win(b.x1, y, z, 1, 0); win(b.x0, y, z, -1, 0);
      }
    }
  }

  // Clock tower faces + spire; fountain basin with water.
  const t = city.tower;
  const clockCol = hexRgb('#fff3cf');
  const clockEmi = [0.9, 0.75, 0.45];
  m.quad([392, 82, 1741], [408, 82, 1741], [408, 92, 1741], [392, 92, 1741], [0, 0, 1], clockCol, clockEmi);
  m.quad([408, 82, 1715], [392, 82, 1715], [392, 92, 1715], [408, 92, 1715], [0, 0, -1], clockCol, clockEmi);
  m.quad([413, 82, 1720], [413, 82, 1736], [413, 92, 1736], [413, 92, 1720], [1, 0, 0], clockCol, clockEmi);
  m.quad([387, 82, 1736], [387, 82, 1720], [387, 92, 1720], [387, 92, 1736], [-1, 0, 0], clockCol, clockEmi);
  m.box(400, 102, 1728, 8, 12, 8, 0, hexRgb('#8a4a34'), { top: hexRgb('#5c2f22') });
  const f = city.fountain;
  for (let i = 0; i < 8; i += 1) {
    const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
    const r = f.r;
    m.quad(
      [f.x + Math.cos(a0) * r, 0, f.z + Math.sin(a0) * r],
      [f.x + Math.cos(a1) * r, 0, f.z + Math.sin(a1) * r],
      [f.x + Math.cos(a1) * r, 1.6, f.z + Math.sin(a1) * r],
      [f.x + Math.cos(a0) * r, 1.6, f.z + Math.sin(a0) * r],
      [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)], hexRgb('#cbb98f'));
  }
  m.ground(f.x - f.r + 2, f.z - f.r + 2, f.x + f.r - 2, f.z + f.r - 2, 1.2, hexRgb('#4ba3ad'), { spec: 0.9 });
  m.box(f.x, 2.4, f.z, 2, 2.4, 2, 0, hexRgb('#cbb98f'));

  // Trees, lamps (with light pools), traffic lights, boats, benches, bins.
  for (const tr of city.trees) {
    m.box(tr.x, 1.5 * tr.s, tr.z, 0.5 * tr.s, 3 * tr.s, 0.5 * tr.s, 0, hexRgb('#6b4a2f'));
    m.box(tr.x, 4 * tr.s, tr.z, 2.6 * tr.s, 2.2 * tr.s, 2.6 * tr.s, 0, shade(hexRgb('#3f7a4a'), rng, 0.2));
    m.box(tr.x, 5.6 * tr.s, tr.z, 1.8 * tr.s, 1.6 * tr.s, 1.8 * tr.s, 0, shade(hexRgb('#56856b'), rng, 0.2));
  }
  for (const l of city.lamps) {
    m.box(l.x, 3.25, l.z, 0.3, 6.5, 0.3, 0, hexRgb('#2c3438'));
    m.box(l.x, 6.6, l.z, 1.4, 0.35, 0.6, 0, hexRgb('#3a444a'), { emi: [0.9, 0.7, 0.4] });
    m.ground(l.x - 2.5, l.z - 2.5, l.x + 2.5, l.z + 2.5, 0.1, hexRgb('#ffca7a'), { emi: [0.35, 0.22, 0.08] });
  }
  for (const tl of city.lights) {
    // Pole + housing only: the lenses are drawn dynamically per frame (their
    // lit state follows the sim's light cycle). The lens boxes sit at z+0.56.
    m.box(tl.x, 2.75, tl.z, 0.3, 5.5, 0.3, 0, hexRgb('#2c3438'));
    m.box(tl.x, 5.8, tl.z, 1.0, 2.4, 1.0, 0, hexRgb('#1a1d20'));
  }
  for (const bo of city.boats) {
    m.box(bo.x, 1, bo.z, bo.len, 2, 5, bo.yaw, hexRgb('#8a4a34'), { top: hexRgb('#d8cbb2') });
    m.box(bo.x, 2.6, bo.z, bo.len * 0.4, 1.2, 3, bo.yaw, hexRgb('#e8e2d2'));
  }
  for (const bn of city.benches) {
    m.box(bn.x, 0.5, bn.z, 3, 0.4, 1, bn.yaw, hexRgb('#8a6a42'));
    m.box(bn.x, 1.0, bn.z - 0.45, 3, 1.0, 0.25, bn.yaw, hexRgb('#8a6a42'));
  }
  for (const bn of city.bins) m.box(bn.x, 0.6, bn.z, 0.8, 1.2, 0.8, 0, hexRgb('#3a5a3a'));

  // Neon signs: glowing canvas-texture quads + a light pool on the pavement.
  for (const sg of city.signs) {
    const row = atlas.rows[sg.text];
    const uvs = [[0, row.v0], [1, row.v0], [1, row.v1], [0, row.v1]];
    const col = hexRgb(sg.color);
    m.quad(
      [sg.x - sg.w / 2, sg.y - sg.h / 2, sg.z], [sg.x + sg.w / 2, sg.y - sg.h / 2, sg.z],
      [sg.x + sg.w / 2, sg.y + sg.h / 2, sg.z], [sg.x - sg.w / 2, sg.y + sg.h / 2, sg.z],
      [0, 0, 1], col, [0, 0, 0], { tex: 1, uvs });
    m.ground(sg.x - sg.w / 2, sg.z + 1, sg.x + sg.w / 2, sg.z + 9, 0.1, hexRgb(sg.color), { emi: [0.3, 0.2, 0.1] });
  }

  return { mesh: m, atlas };
}

// --- Minimal mat4 helpers (column-major, like WebGL expects). ---
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, target, up) {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz), z = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1], xy = up[2] * z[0] - up[0] * z[2], xz = up[0] * z[1] - up[1] * z[0];
  const xl = Math.hypot(xx, xy, xz), x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1];
}
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function neg3(v) { return [-v[0], -v[1], -v[2]]; }

function buildSky(rng) {
  const m = new Mesh();
  // Sun disc + halo: fan of 24 triangles around the local unit circle.
  // The halo's verts carry aUV.y = 8, pushing them 8 m behind the disc.
  const fan = (kind, col, radiusMul, halo) => {
    const emi = kind === 'sun' ? [1, 0, 0] : [0, 1, 0];
    for (let i = 0; i < 24; i += 1) {
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
      const c = [0, 0, 0], p0 = [Math.cos(a0), Math.sin(a0), 0], p1 = [Math.cos(a1), Math.sin(a1), 0];
      for (const p of [c, p0, p1]) {
        m.v(p[0], p[1], p[2], 0, 0, 0, col, emi, 0, halo ? 8 : 0, 0, 1, radiusMul, 1);
      }
    }
  };
  fan('sun', hexRgb('#ffdf9e'), 1, false);
  fan('sun', hexRgb('#c25a20'), 1.5, true);
  fan('moon', hexRgb('#dfe8f2'), 1, false);
  // Stars: tiny quads at random upper-hemisphere directions.
  for (let i = 0; i < 220; i += 1) {
    const az = rng() * Math.PI * 2, el = Math.asin(rng() * 0.95 + 0.05);
    const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    const b = 0.5 + rng() * 0.5;
    const col = [b, b, Math.min(1, b + 0.1)];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const idx = [0, 1, 2, 0, 2, 3];
    for (const k of idx) {
      const [ox, oy] = corners[k];
      m.v(ox, oy, 0, dir[0], dir[1], dir[2], col, [0, 0, 1], 0, 0, 0, 1, 1, 1);
    }
  }
  return m;
}

// One car in the dynamic mesh: body + cabin + 4 wheels + headlights + taillights.
// Every car the city defines goes through this same pass — parked, drivable, traffic.
function drawCar(m, car) {
  const c = Math.cos(car.yaw), s = Math.sin(car.yaw);
  const rot = (x, z) => [car.x + x * c + z * s, car.z - x * s + z * c];
  const part = (ox, oy, oz, sx, sy, sz, col, o = {}) => {
    const [wx, wz] = rot(ox, oz);
    m.box(wx, oy, wz, sx, sy, sz, car.yaw, col, o);
  };
  const body = hexRgb(car.color);
  part(0, 1.05, 0, 2.0, 1.35, 4.4, body, { top: shade(body, () => 0.5, 0.15), spec: 0.5 });
  part(0, 1.95, -0.2, 1.8, 0.85, 2.3, hexRgb('#1c222b'), { spec: 0.6 });
  for (const [wx, wz] of [[-0.95, -1.45], [0.95, -1.45], [-0.95, 1.45], [0.95, 1.45]]) {
    part(wx, 0.35, wz, 0.4, 0.7, 0.7, hexRgb('#14161a'));
  }
  part(-0.6, 0.9, -2.21, 0.5, 0.25, 0.1, hexRgb('#fff2cc'), { emi: [0.9, 0.8, 0.5] });
  part(0.6, 0.9, -2.21, 0.5, 0.25, 0.1, hexRgb('#fff2cc'), { emi: [0.9, 0.8, 0.5] });
  part(-0.6, 0.95, 2.21, 0.5, 0.25, 0.1, hexRgb('#ff2a1a'), { emi: [0.8, 0.1, 0.05] });
  part(0.6, 0.95, 2.21, 0.5, 0.25, 0.1, hexRgb('#ff2a1a'), { emi: [0.8, 0.1, 0.05] });
}

// One pedestrian: legs + jacket torso + head, rotated by yaw.
function drawPed(m, p) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const rot = (x, z) => [p.x + x * c + z * s, p.z - x * s + z * c];
  const part = (ox, oy, oz, sx, sy, sz, col) => {
    const [wx, wz] = rot(ox, oz);
    m.box(wx, oy, wz, sx, sy, sz, p.yaw, col);
  };
  const jacket = hexRgb(p.jacket || '#7a4a8a');
  part(0, 0.4, 0, 0.5, 0.8, 0.35, hexRgb('#2c3438')); // legs
  part(0, 1.15, 0, 0.62, 0.7, 0.4, jacket); // torso
  part(0, 1.68, 0, 0.36, 0.36, 0.36, hexRgb('#d8a882')); // head
}

// Mission marker: ground disc + floating bobbing diamond. The beam is drawn in
// the additive pass (a solid pillar would read as a wall in daylight).
function drawMarker(m, marker, time) {
  const col = hexRgb(marker.color || '#ffd21a');
  const emi = [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85];
  // Ground disc: 12-triangle fan at y=0.12.
  const cx = marker.x, cz = marker.z;
  for (let i = 0; i < 12; i += 1) {
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    m.tri([cx, 0.12, cz],
      [cx + Math.cos(a0) * 3, 0.12, cz + Math.sin(a0) * 3],
      [cx + Math.cos(a1) * 3, 0.12, cz + Math.sin(a1) * 3],
      [0, 1, 0], col, emi);
  }
  // Floating diamond (octahedron): bobs with time.
  const y = 4.5 + Math.sin(time * 2.5) * 0.6;
  const top = [cx, y + 1.3, cz], bot = [cx, y - 1.3, cz];
  const eq = [];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    eq.push([cx + Math.cos(a) * 1.1, y, cz + Math.sin(a) * 1.1]);
  }
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    m.tri(top, eq[i], eq[j], [0, 1, 0], col, emi);
    m.tri(bot, eq[j], eq[i], [0, -1, 0], col, emi);
  }
}

// Traffic-light lenses, one per light: the active lens glows, the others are dim.
function drawLenses(m, lights) {
  const defs = [
    { y: 6.5, col: '#ff2a1a', on: [0.9, 0.1, 0.05], off: [0.05, 0.01, 0.01], state: 'red' },
    { y: 5.8, col: '#ffb400', on: [0.9, 0.6, 0.05], off: [0.06, 0.04, 0.01], state: 'yellow' },
    { y: 5.1, col: '#2aff5a', on: [0.1, 0.9, 0.2], off: [0.01, 0.05, 0.02], state: 'green' },
  ];
  for (const l of lights || []) {
    for (const d of defs) {
      const lit = l.state === d.state;
      m.box(l.x, d.y, l.z + 0.56, 0.5, 0.5, 0.2, 0, hexRgb(d.col), { emi: lit ? d.on : d.off });
    }
  }
}

// A headlight cone as a stack of additive discs facing the camera (a light
// shaft). Crossed trapezoids do NOT work from the chase view: the vertical one
// is edge-on to the camera, so it covers ~0 pixels. The discs face the camera
// directly, so they wash the road and the car ahead; each disc is dimmer and
// wider than the last (apex bright warm, base dim).
function drawCone(m, hx, hy, hz, yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const zero = [0, 0, 0];
  const discs = [
    // Summed centre brightness ~0.5 (not 2.65): the old values blew the beam
    // out to a white blob (+202 gain). Elliptical (taller than wide) so the
    // discs reach the roof of the car ahead, 1.1 m above the beam axis.
    { d: 5, r: 0.8, e: [0.18, 0.15, 0.09] },
    { d: 9, r: 1.3, e: [0.13, 0.11, 0.06] },
    { d: 13, r: 1.8, e: [0.09, 0.08, 0.04] },
    { d: 17, r: 2.3, e: [0.06, 0.05, 0.03] },
    { d: 21, r: 2.8, e: [0.04, 0.03, 0.02] },
  ];
  for (const disc of discs) {
    const cx = hx + fx * disc.d, cy = hy, cz = hz + fz * disc.d;
    const seg = 12;
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + rx * Math.cos(a0) * disc.r, cy + Math.sin(a0) * disc.r * 1.5, cz + rz * Math.cos(a0) * disc.r];
      const p1 = [cx + rx * Math.cos(a1) * disc.r, cy + Math.sin(a1) * disc.r * 1.5, cz + rz * Math.cos(a1) * disc.r];
      // Fan triangle: centre, p0, p1. (The disc's up axis is world Y.)
      m.v(cx, cy, cz, 0, 1, 0, zero, disc.e, 0, 0, 0, 1, 0, 0);
      m.v(p0[0], p0[1], p0[2], 0, 1, 0, zero, disc.e, 0, 0, 0, 1, 0, 0);
      m.v(p1[0], p1[1], p1[2], 0, 1, 0, zero, disc.e, 0, 0, 0, 1, 0, 0);
    }
  }
}

// Ground light pool ahead of the car: bright near, dim far (per-vertex emissive).
function drawPool(m, hx, hz, yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const near = 3, far = 24, wNear = 2.2, wFar = 5.5;
  const bright = [0.45, 0.36, 0.2], dim = [0.05, 0.04, 0.02];
  const zero = [0, 0, 0];
  const p = (along, side, e) => {
    const x = hx + fx * along + rx * side, z = hz + fz * along + rz * side;
    m.v(x, 0.1, z, 0, 1, 0, zero, e, 0, 0, 0, 1, 0, 0);
  };
  p(near, -wNear, bright); p(near, wNear, bright); p(far, wFar, dim);
  p(near, -wNear, bright); p(far, wFar, dim); p(far, -wFar, dim);
}

export function createRenderer(canvas, city) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const loc = (name) => gl.getUniformLocation(prog, name);
  const U = {
    proj: loc('uProj'), view: loc('uView'), camPos: loc('uCamPos'),
    lightDir: loc('uLightDir'), lightCol: loc('uLightCol'), amb: loc('uAmb'),
    fogCol: loc('uFogCol'), fogDen: loc('uFogDen'), emiBoost: loc('uEmiBoost'),
    sunI: loc('uSunI'), moonI: loc('uMoonI'), starI: loc('uStarI'),
    sunDir: loc('uSunDir'), moonDir: loc('uMoonDir'), tex: loc('uTex'),
  };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const bindAttribs = (buf) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = 18 * 4;
    const attrs = [['aPos', 3, 0], ['aNor', 3, 3], ['aCol', 3, 6], ['aEmi', 3, 9], ['aUV', 2, 12], ['aMisc', 4, 14]];
    for (const [name, size, off] of attrs) {
      const l = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off * 4);
    }
  };

  const { mesh, atlas } = buildStatic(city);
  const staticData = mesh.toArray();
  const staticBuf = gl.createBuffer();
  bindAttribs(staticBuf);
  gl.bufferData(gl.ARRAY_BUFFER, staticData, gl.STATIC_DRAW);
  const staticCount = mesh.count;

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const skyMesh = buildSky(createRandom(city.seed + 13));
  const skyData = skyMesh.toArray();
  const skyBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, skyData, gl.STATIC_DRAW);
  const skyCount = skyMesh.count;

  const dyn = new Mesh(1000000);
  const dynBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
  gl.bufferData(gl.ARRAY_BUFFER, dyn.buf.byteLength, gl.DYNAMIC_DRAW);

  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  const moonDir = norm3([-0.18, 0.36, -0.92]);

  // Project a world point to drawing-buffer pixels (origin top-left).
  // Same math as draw(): perspective * lookAt. Returns {x, y, behind}.
  function projectWorld(view, point) {
    const w = canvas.width || 1280, h = canvas.height || 720;
    const proj = perspective(Math.PI / 3, w / h, 0.5, 4000);
    const vw = lookAt(view.cam, view.target, [0, 1, 0]);
    const p = [point[0], point[1], point[2], 1];
    // view * p
    const v = [
      vw[0] * p[0] + vw[4] * p[1] + vw[8] * p[2] + vw[12] * p[3],
      vw[1] * p[0] + vw[5] * p[1] + vw[9] * p[2] + vw[13] * p[3],
      vw[2] * p[0] + vw[6] * p[1] + vw[10] * p[2] + vw[14] * p[3],
      vw[3] * p[0] + vw[7] * p[1] + vw[11] * p[2] + vw[15] * p[3],
    ];
    // proj * v
    const c = [
      proj[0] * v[0] + proj[4] * v[1] + proj[8] * v[2] + proj[12] * v[3],
      proj[1] * v[0] + proj[5] * v[1] + proj[9] * v[2] + proj[13] * v[3],
      proj[2] * v[0] + proj[6] * v[1] + proj[10] * v[2] + proj[14] * v[3],
      proj[3] * v[0] + proj[7] * v[1] + proj[11] * v[2] + proj[15] * v[3],
    ];
    if (c[3] <= 0) return { x: 0, y: 0, behind: true };
    const nx = c[0] / c[3], ny = c[1] / c[3];
    return { x: ((nx + 1) / 2) * w, y: ((1 - ny) / 2) * h, behind: false };
  }

  function draw(view) {
    const preset = PRESETS[view.preset] || PRESETS.midday;
    const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    const sky = hexRgb(preset.sky);
    gl.clearColor(sky[0], sky[1], sky[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(U.proj, false, perspective(Math.PI / 3, canvas.width / canvas.height, 0.5, 4000));
    gl.uniformMatrix4fv(U.view, false, lookAt(view.cam, view.target, [0, 1, 0]));
    gl.uniform3fv(U.camPos, view.cam);
    gl.uniform3fv(U.lightDir, norm3(preset.lightDir));
    gl.uniform3fv(U.lightCol, preset.lightCol);
    gl.uniform3fv(U.amb, preset.amb);
    gl.uniform3fv(U.fogCol, hexRgb(preset.fog));
    // view.haze === false disables the fog (headlight test control).
    gl.uniform1f(U.fogDen, view.haze === false ? 0 : preset.fogDen);
    gl.uniform1f(U.emiBoost, preset.emi);
    gl.uniform1f(U.sunI, preset.sunI);
    gl.uniform1f(U.moonI, preset.moonI);
    gl.uniform1f(U.starI, preset.starI);
    gl.uniform3fv(U.sunDir, neg3(norm3(preset.lightDir)));
    gl.uniform3fv(U.moonDir, moonDir);
    gl.uniform1i(U.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    bindAttribs(staticBuf);
    gl.drawArrays(gl.TRIANGLES, 0, staticCount);

    dyn.reset();
    for (const car of view.cars || []) drawCar(dyn, car);
    for (const p of view.peds || []) drawPed(dyn, p);
    if (view.mara) drawPed(dyn, { ...view.mara, jacket: '#d77f69' });
    for (const mk of view.markers || []) drawMarker(dyn, mk, view.time || 0);
    drawLenses(dyn, view.lights || []);
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
    bindAttribs(dynBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn.toArray());
    gl.drawArrays(gl.TRIANGLES, 0, dyn.count);

    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    bindAttribs(skyBuf);
    gl.drawArrays(gl.TRIANGLES, 0, skyCount);

    // Additive pass: headlight cones + ground pool + marker beams. Depth-tested
    // (occluded by buildings/cars) but depth-write off, ONE/ONE blending.
    const hl = view.headlights;
    const beams = view.markers || [];
    if ((hl && hl.on) || beams.length) {
      dyn.reset();
      if (hl && hl.on) {
        const fx = -Math.sin(hl.yaw), fz = -Math.cos(hl.yaw);
        const rx = Math.cos(hl.yaw), rz = -Math.sin(hl.yaw);
        for (const side of [-0.6, 0.6]) {
          // Apex at the front bumper (2.2 m ahead of the centre) + lateral offset.
          const hx = hl.x + fx * 2.2 + rx * side, hz = hl.z + fz * 2.2 + rz * side;
          drawCone(dyn, hx, 0.9, hz, hl.yaw);
        }
        drawPool(dyn, hl.x + fx * 2.2, hl.z + fz * 2.2, hl.yaw);
      }
      for (const mk of beams) {
        // Two crossed vertical quads, dim warm, from the ground to y=25.
        const col = hexRgb(mk.color || '#ffd21a');
        const e = [col[0] * 0.25, col[1] * 0.25, col[2] * 0.25];
        const zero = [0, 0, 0];
        const q = (x0, z0, x1, z1) => {
          dyn.v(x0, 0, z0, 0, 1, 0, zero, e, 0, 0, 0, 1, 0, 0);
          dyn.v(x1, 0, z1, 0, 1, 0, zero, e, 0, 0, 0, 1, 0, 0);
          dyn.v(x1, 25, z1, 0, 1, 0, zero, e, 0, 0, 0, 1, 0, 0);
          dyn.v(x0, 0, z0, 0, 1, 0, zero, e, 0, 0, 0, 1, 0, 0);
          dyn.v(x1, 25, z1, 0, 1, 0, zero, e, 0, 0, 0, 1, 0, 0);
          dyn.v(x0, 25, z0, 0, 1, 0, zero, e, 0, 0, 0, 1, 0, 0);
        };
        q(mk.x - 0.6, mk.z, mk.x + 0.6, mk.z);
        q(mk.x, mk.z - 0.6, mk.x, mk.z + 0.6);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
      bindAttribs(dynBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn.toArray());
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, dyn.count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  return { draw, projectWorld, gl, stats: { staticVerts: staticCount, skyVerts: skyCount } };
}
