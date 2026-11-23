import * as S from '../site/sim/core.js';
const hours = +process.argv[2] || 6;
const w = S.genesis(); if (process.argv[3]) w.rng = +process.argv[3];
const t0 = performance.now();
const end = hours * 3600 * 4;
let last = performance.now();
for (let t = 0; t < end; t++) {
  S.step(w);
  if (w.tick % 2400 === 0) {
    const nd = w.creatures.filter(c => c.s === 0).length, ng = w.creatures.length - nd;
    let ber = 0; for (const b of w.bushes) ber += b.b;
    const now = performance.now();
    const h = w.hist.fine.at(-1);
    console.log(`${(w.tick/14400).toFixed(2)}h ${S.SEASONS[S.seasonIndex(w.tick)].padEnd(6)} D=${String(nd).padStart(3)} G=${String(ng).padStart(2)} berries=${String(ber).padStart(4)}/${w.bushes.length} dsz=${h[4]} dsp=${h[5]} dsi=${h[6]} gsz=${h[7]} gsp=${h[8]} | ${((now-last)/2400*1000).toFixed(1)}us/tick`);
    last = now;
  }
}
console.log('total', ((performance.now()-t0)/1000).toFixed(1)+'s', 'stats', JSON.stringify(w.stats), 'snapshot', S.serialize(w).length);
console.log(w.events.slice(-15).map(e=>`${(e.t/14400).toFixed(2)}h ${e.text}`).join('\n'));
