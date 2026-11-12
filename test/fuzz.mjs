// Random-play fuzzing of the rules engine: node test/fuzz.mjs [firstSeed] [count] [--ages=6] [--opponents=1] [--civs] [-v]
import { playRandomGame } from './harness.mjs';
import { normalizeOpponents } from '../src/engine/queries.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const verbose = process.argv.includes('-v');
const civs = process.argv.includes('--civs');
const opt = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || undefined;
const first = Number(args[0] || 1);
const count = Number(args[1] || 10);
const ages = opt('ages');
const opponents = normalizeOpponents(opt('opponents'));
let bad = 0;
const total = {};
for (let i = 0; i < count; i++) {
  const seed = first + i;
  const t0 = Date.now();
  const r = playRandomGame({ seed, ages, opponents, civs });
  const s = r.g.s;
  for (const [k, v] of Object.entries(r.stats.events)) total[k] = (total[k] || 0) + v;
  if (verbose || !r.over || r.errors.length) {
    console.log(`seed ${seed}: ${r.over ? 'over' : 'unfinished'} age ${s.age} steps ${r.steps} rejected ${r.rejected} cities ${s.cities.length} ${Date.now() - t0}ms`);
  }
  if (r.errors.length) {
    bad += 1;
    console.log(r.errors.slice(0, 3).join('\n'));
  }
}
console.log('events:', JSON.stringify(total));
process.exit(bad ? 1 : 0);
