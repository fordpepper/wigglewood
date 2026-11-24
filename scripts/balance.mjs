// Simulates the world headless and prints populations per island:
//   node scripts/balance.mjs [hours]
import * as S from '../site/sim/core.js';
const hours = +process.argv[2] || 6;
const w = S.genesis();
const t0 = performance.now();
const end = hours * 3600 * 4;
const homes = [...S.homes().keys()];
console.log('islands:', homes.map(il => `${S.islandName(il)} (${S.homes().get(il).length} groves)`).join(', '));
let last = performance.now();
for (let t = 0; t < end; t++) {
  S.step(w);
  if (w.tick % 4800 === 0) {
    const per = homes.map(il => {
      const cs = w.creatures.filter(c => c.il === il);
      const d = cs.filter(c => c.s === 0), g = cs.length - d.length;
      const sz = d.length ? (d.reduce((a, c) => a + c.g[0], 0) / d.length).toFixed(2) : '-';
      return `${S.islandName(il).slice(0, 6)} ${String(d.length).padStart(3)}/${String(g).padStart(2)} s${sz}`;
    });
    const now = performance.now();
    console.log(`${(w.tick / 14400).toFixed(1).padStart(5)}h ${S.SEASONS[S.seasonIndex(w.tick)].padEnd(6)} ${per.join(' | ')} | ${((now - last) / 4800 * 1000).toFixed(0)}us/tick`);
    last = now;
  }
}
console.log('total', ((performance.now() - t0) / 1000).toFixed(1) + 's', 'stats', JSON.stringify(w.stats), 'snapshot', S.serialize(w).length);
console.log(w.events.slice(-12).map(e => `${(e.t / 14400).toFixed(2)}h ${e.text}`).join('\n'));
