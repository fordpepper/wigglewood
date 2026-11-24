// Visitor edits: send them to the public ntfy.sh topic and listen for everyone's.
import * as S from '../sim/core.js';

export class EditFeed {
  constructor(onEdit) {
    this.onEdit = onEdit;
    this.byId = new Map();
    this.byTick = new Map();
    this.lastId = null;
    this.es = null;
    this.editsAt = tick => this.byTick.get(tick);
  }

  add(e) {
    if (!e || this.byId.has(e.id)) return false;
    this.byId.set(e.id, e);
    const list = this.byTick.get(e.t);
    if (list) { list.push(e); list.sort(S.compareEdits); } else this.byTick.set(e.t, [e]);
    return true;
  }

  // forget edits that are long done
  prune(beforeTick) {
    for (const [t, list] of this.byTick) {
      if (t < beforeTick) { for (const e of list) this.byId.delete(e.id); this.byTick.delete(t); }
    }
  }

  // load everything sent since a unix time (seconds)
  async backfill(sinceSec) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch(`${S.EDIT_URL}/json?poll=1&since=${Math.max(0, Math.floor(sinceSec))}`, { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) return false;
      for (const line of (await res.text()).split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.event === 'message') this.lastId = msg.id;
          this.add(S.parseEdit(msg));
        } catch (e) { /* skip junk */ }
      }
      return true;
    } catch (e) {
      return false;
    } finally { clearTimeout(timer); }
  }

  listen() {
    if (this.es) this.es.close();
    const since = this.lastId || `${Math.floor(Date.now() / 1000) - 30}`;
    const es = this.es = new EventSource(`${S.EDIT_URL}/sse?since=${since}`);
    es.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.event !== 'message') return;
      this.lastId = msg.id;
      const e = S.parseEdit(msg);
      if (this.add(e)) this.onEdit(e);
    };
    es.onerror = () => {
      // reconnect ourselves so we resume from the last edit we saw
      es.close();
      if (this.es === es) setTimeout(() => this.listen(), 5000);
    };
  }
}

let lastSent = 0;
export const COOLDOWN_MS = 1500;
export function cooldownLeft() { return Math.max(0, lastSent + COOLDOWN_MS - Date.now()); }

// returns '' on success or a short reason
export async function sendEdit(edit) {
  if (cooldownLeft() > 0) return 'Easy there. One change at a time.';
  lastSent = Date.now();
  edit.t = S.tickAt(Date.now()) + S.EDIT_DELAY;
  try {
    const res = await fetch(S.EDIT_URL, { method: 'POST', body: JSON.stringify(edit) });
    if (res.status === 429) return 'Too many changes from your network right now. Try again in a minute.';
    if (!res.ok) return 'The island didn’t get that. Try again in a moment.';
    return '';
  } catch (e) {
    return 'Couldn’t reach the island’s mailbox. Are you offline?';
  }
}
