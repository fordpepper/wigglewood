// Advances the shared world to the most recent checkpoint and writes the snapshot.
// Run by GitHub Actions every 30 minutes:  node scripts/advance.mjs <prev.json> <out-dir>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as S from '../site/sim/core.js';

const [prevPath, outDir = 'site/state'] = process.argv.slice(2);
let w = null;
if (prevPath && existsSync(prevPath)) {
  try {
    w = S.deserialize(readFileSync(prevPath, 'utf8'));
    console.log(`loaded snapshot at tick ${w.tick}`);
  } catch (e) {
    console.log(`could not use previous snapshot (${e.message}); starting from genesis`);
  }
}
if (!w) w = S.genesis();

const now = S.tickAt(Date.now());
const target = Math.floor(now / S.CHECKPOINT_TICKS) * S.CHECKPOINT_TICKS;
const t0 = performance.now();
const from = w.tick;
if (target > w.tick) S.advance(w, target);
const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`advanced ${from} -> ${w.tick} (${w.tick - from} ticks) in ${secs}s, ${w.creatures.length} creatures`);

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/latest.json`, S.serialize(w));
writeFileSync(`${outDir}/meta.json`, JSON.stringify({
  v: S.SIM_VERSION, tick: w.tick, checksum: S.checksum(w), at: new Date(S.msAt(w.tick)).toISOString(),
  creatures: w.creatures.length,
}));
console.log(`wrote ${outDir}/latest.json checksum ${S.checksum(w)}`);
