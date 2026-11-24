// The island's heartbeat, run by .github/workflows/heartbeat.yml.
//
// Every 30 minutes it loads the last checkpoint from the `state` branch,
// simulates up to the latest 30-minute boundary and force-pushes the new
// checkpoint (a single commit, so the branch never grows). Browsers read it
// straight from raw.githubusercontent.com.
//
// It keeps going for a few hours and then exits so the workflow can hand over
// to a fresh run. It also exits early when the simulation code on `main`
// changes, so the next run picks up the new rules.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as S from '../site/sim/core.js';

const MAX_MS = (+process.env.HEARTBEAT_MINUTES || 330) * 60 * 1000;
const started = Date.now();
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const work = `${process.env.RUNNER_TEMP || '/tmp'}/wigglewood-state`;

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const remote = repo && token ? `https://x-access-token:${token}@github.com/${repo}.git` : git(['remote', 'get-url', 'origin']).trim();
const sha = s => createHash('sha256').update(s).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

const myCode = sha(readFileSync(new URL('../site/sim/core.js', import.meta.url)));

function codeOnMain() {
  try {
    git(['fetch', '-q', '--depth=1', remote, 'main']);
    return sha(git(['show', 'FETCH_HEAD:site/sim/core.js']));
  } catch (e) { return myCode; } // can't tell: keep going
}

function lastCheckpoint() {
  try {
    git(['fetch', '-q', '--depth=1', remote, 'state']);
    return S.deserialize(git(['show', 'FETCH_HEAD:latest.json'], { maxBuffer: 64 << 20 }));
  } catch (e) {
    log(`no usable checkpoint (${e.message.split('\n')[0]}), starting from the founding`);
    return null;
  }
}

function save(w) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(`${work}/latest.json`, S.serialize(w));
  writeFileSync(`${work}/meta.json`, JSON.stringify({
    v: S.SIM_VERSION, tick: w.tick, checksum: S.checksum(w), at: new Date(S.msAt(w.tick)).toISOString(),
    creatures: w.creatures.length,
  }));
  const g = (args) => git(args, { cwd: work });
  g(['init', '-q', '-b', 'state']);
  g(['add', 'latest.json', 'meta.json']);
  g(['-c', 'user.name=wigglewood-bot', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-qm', `Checkpoint at tick ${w.tick} (${new Date(S.msAt(w.tick)).toISOString()})`]);
  g(['push', '-fq', remote, 'state']);
}

async function beat() {
  const target = Math.floor(S.tickAt(Date.now()) / S.CHECKPOINT_TICKS) * S.CHECKPOINT_TICKS;
  let w = lastCheckpoint();
  if (w && w.tick >= target) { log(`checkpoint ${w.tick} is current`); return; }
  if (!w) w = S.genesis();
  const from = w.tick, t0 = performance.now();
  S.advance(w, target);
  log(`advanced ${from} -> ${w.tick} in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${w.creatures.length} creatures, checksum ${S.checksum(w)}`);
  save(w);
  log('pushed to the state branch');
}

for (;;) {
  try { await beat(); } catch (e) { log(`beat failed: ${e.stack || e}`); }
  const next = S.msAt((Math.floor(S.tickAt(Date.now()) / S.CHECKPOINT_TICKS) + 1) * S.CHECKPOINT_TICKS) + 20_000;
  if (process.argv.includes('--once')) break;
  if (next - started > MAX_MS) { log('handing over to a fresh run'); handOver(); break; }
  await sleep(Math.max(1000, next - Date.now()));
  if (codeOnMain() !== myCode) { log('simulation code changed on main; handing over so the new rules are used'); handOver(); break; }
}

// tells the workflow to start the next run (only on a planned exit, so a crash can't loop)
function handOver() { if (process.env.RUNNER_TEMP) writeFileSync(`${process.env.RUNNER_TEMP}/handover`, '1'); }
