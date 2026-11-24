# Wigglewood

**[Open the island](https://fordpepper.github.io/wigglewood/)**

![Dumplings and grumbles on the island](site/og.jpg)

A tiny island ecosystem that never stops. Dumplings eat berries, grumbles eat
dumplings, and both have babies that inherit their parents' genes (size, speed,
sight, colour, hats) with small mutations, so the island slowly evolves.

**Everyone sees the same world.** The state of the island is a pure function of
the current time: open it on two devices at once and the same creatures are in
the same places. No accounts, no server, just GitHub.

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
  the same path as the Action. Browsers compare checksums with GitHub's checkpoints
  to catch any drift.
- Pushing to `main` publishes the page to GitHub Pages (`world.yml`).
- **Visitors can meddle**: tap a creature to see who it is, double tap to poke it
  (enough pokes and it's gone), press and hold to pick it up and drop it somewhere
  else. Edits are posted to a public [ntfy.sh](https://ntfy.sh) topic, so nobody
  needs an account. Each edit names the tick it takes effect on, three seconds
  ahead, and whether it counts is decided only from the edit and ntfy's
  timestamp, so every browser and the heartbeat apply exactly the same edits at
  the same moment. A browser that hears about an edit late rewinds a few seconds
  and replays. The island accepts at most 40 edits a minute in total.
- When nobody touches anything for a while the camera drifts from one
  interesting creature to the next, so it works as something to just watch.
- No cookies and no local storage: nothing is saved in your browser.
- Slow devices switch to a light mode automatically (1x pixels, 30 fps, fewer
  effects). `?quality=low` or `?quality=high` forces one.
- Day and night follow the viewer's own clock (that part is only drawn, not
  simulated, so the shared world is the same in every timezone). Seasons belong
  to the island: each one lasts three real hours.

## Running locally

```sh
node scripts/advance.mjs none site/state   # build a checkpoint for "now"
cd site && python3 -m http.server 8000     # then open http://localhost:8000
```

Other tools:

```sh
node scripts/test-determinism.mjs          # continuous vs. reloaded runs must match
node scripts/balance.mjs 48                # simulate 48 hours headless, print populations
```

`?season=0..3&hour=0..24` in the URL previews a season or time of day (drawing
only; the world itself is unaffected).

## Changing the rules

Any change to `site/sim/core.js` changes the world's future from the next
checkpoint on (the heartbeat notices new code on `main` and restarts with it).
If a change makes old checkpoints unreadable, bump `SIM_VERSION`: the world is
then rebuilt from its founding moment, which takes longer the older it is.

Font: [Comic Neue](https://github.com/crozynski/comicneue) (SIL Open Font License).
