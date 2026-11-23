// Checks that a world advanced in one go equals one that was saved and reloaded
// at checkpoints (the path browsers take), and prints a checksum to compare
// against browsers (see dev/browser-check.mjs).
import * as S from '../site/sim/core.js';

const T = +(process.argv[2] || S.CHECKPOINT_TICKS * 3 + 1234);
const a = S.genesis();
S.advance(a, T);

let b = S.deserialize(S.serialize(S.genesis()));
while (b.tick < T) {
  const next = Math.min(T, (Math.floor(b.tick / S.CHECKPOINT_TICKS) + 1) * S.CHECKPOINT_TICKS);
  S.advance(b, next);
  if (b.tick % S.CHECKPOINT_TICKS === 0) b = S.deserialize(S.serialize(b));
}
// a third path: resume from the first checkpoint snapshot only
const c0 = S.genesis(); S.advance(c0, S.CHECKPOINT_TICKS);
const c = S.deserialize(S.serialize(c0)); S.advance(c, T);

const ha = S.checksum(a), hb = S.checksum(b), hc = S.checksum(c);
console.log(`tick ${T}: continuous ${ha}  reloaded-every-checkpoint ${hb}  resumed ${hc}`);
if (ha !== hb || ha !== hc) { console.error('DETERMINISM FAILURE'); process.exit(1); }
console.log('ok');
