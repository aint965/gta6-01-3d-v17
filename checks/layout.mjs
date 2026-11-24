// Layout verifier for Solmar: run `node checks/layout.mjs` from the repo root.
// Prints counts and every problem; exits non-zero when the city is not clean.
import { generateCity, layoutCheck, SEED } from '../game/src/city.js';

const city = generateCity(SEED);
const { problems, counts } = layoutCheck(city);
console.log(JSON.stringify(counts));
if (problems.length === 0) {
  console.log('LAYOUT OK: 0 problems');
} else {
  console.log(`LAYOUT PROBLEMS: ${problems.length}`);
  for (const p of problems.slice(0, 40)) console.log(' - ' + p);
  process.exit(1);
}
