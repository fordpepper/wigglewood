# Wigglewood

**[Open the islands](https://fordpepper.github.io/wigglewood/)**

![Dumplings and grumbles on the islands](site/og.jpg)

A pixel art world of islands that never stops. Dumplings eat berries, grumbles eat
dumplings, and both have babies that inherit their parents' genes (size, speed,
sight, colour, hats) with small mutations, so the creatures slowly evolve.

The world is big (19200 by 12800 world units) and mostly sea. Seven big,
odd-shaped islands, a few small ones and a scattering of islets sit in it, cold in the north and hot in the south, with
nine biomes between them: tundra, taiga, meadow, forest, steppe, swamp, savanna,
jungle and desert, each with its own ground, trees, berry bushes and seasons.
Creatures can't swim, so every island's population evolves on its own: each
island's founders have their own colours, and big bodies are cheaper to keep
warm in the cold and costlier in the heat, so over many generations the polar
islands breed bigger creatures and the tropical ones smaller. Life gathers in a
few berry groves per island; the land in between stays quiet.

**Everyone sees the same world.** The state of the world is a pure function of
the current time: open it on two devices at once and the same creatures are in
the same places. No accounts, no server, just GitHub. Nobody can change it:
you can look around, tap a creature to see who it is, and double tap anywhere
(or press `/`) to find someone by name. That's all.

## How it works

- `site/sim/core.js` is a deterministic simulation. It only uses arithmetic that
  IEEE-754 pins down exactly (`+ - * /`, `sqrt`, integer ops), its own seeded RNG
  and its own sine, so Node and every browser compute bit-identical results.
  One tick is 250 ms of real time, counted from the world's founding (`EPOCH_MS`).
- A GitHub Action, the heartbeat (`.github/workflows/heartbeat.yml`), loads the
  last checkpoint from the `state` branch every 30 minutes, simulates up to the
  current 30-minute boundary and force-pushes the new checkpoint (one commit, so
  the branch never grows). Each heartbeat run lasts about five and a half hours
  and then starts its successor; a cron entry and every push to `main` restart
  the chain if it ever breaks.
- Your browser reads that checkpoint straight from the `state` branch (via
  raw.githubusercontent.com), simulates the remaining minutes itself, and then
  keeps running in real time. State is round-tripped through JSON at every
  checkpoint, so a browser that started from an older checkpoint follows exactly
  the same path as the Action.
- **After loading, the page never touches the network again.** Fonts and the
  checkpoint are fetched while the loader shows; from then on everything runs on
  your device. If the tab sleeps for a while, it simulates the missed time
  locally when you come back.
- Pushing to `main` publishes the page to GitHub Pages (`world.yml`).
- When nobody touches anything for a while the camera drifts from one
  interesting creature to the next, rising up and gliding over the sea when the
  next one lives on another island, so it works as something to just watch.
- No cookies and no local storage: nothing is saved in your browser.
- Everything is pixel art drawn procedurally (`site/js/pixel.js`, `sprites.js`,
  `terrain.js`): the world is painted into a small buffer, one pixel per art
  pixel, and scaled up with hard edges. Zoom settles on whole-pixel sizes; far
  out, trees are baked into the ground tiles so the whole world is cheap to show.
- Slow devices drop to 30 fps and fewer effects automatically.
  `?quality=low` or `?quality=high` forces one.
- Day and night follow the viewer's own clock (that part is only drawn, not
  simulated, so the shared world is the same in every timezone). Seasons belong
  to the world: each one lasts three real hours. Weather is shared too, but falls
  differently by climate: no rain in the desert, rain instead of snow in the
  tropics, snow in the far north.

## Running locally

```sh
node scripts/advance.mjs none site/state   # build a checkpoint for "now"
cd site && python3 -m http.server 8000     # then open http://localhost:8000
```

Other tools:

```sh
node scripts/test-determinism.mjs          # continuous vs. reloaded runs must match
node scripts/balance.mjs 48                # simulate 48 hours headless, print populations per island
```

`?season=0..3&hour=0..24` in the URL previews a season or time of day (drawing
only; the world itself is unaffected).

## Changing the rules

Any change to `site/sim/core.js` changes the world's future from the next
checkpoint on (the heartbeat notices new code on `main` and restarts with it).
If a change makes old checkpoints unreadable, bump `SIM_VERSION`: the world is
then rebuilt from its founding moment, which takes longer the older it is.

Font: [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans) (SIL Open Font License).
