/**
 * Decides what the face shows. Pure: no I/O, the caller passes the clock.
 * See docs/broker.md for the rules.
 */

export const ANIMATIONS = new Set([
  "none",
  "typing",
  "reading",
  "thinking",
  "talking",
  "ring",
  "welcome",
  "attention",
  "error",
  "abort",
  "dead",
  "wakeup",
  "sleep",
]);

const KINDS = new Map([
  ["typing", "state"],
  ["reading", "state"],
  ["thinking", "state"],
  ["talking", "state"],
  ["attention", "attention"],
  ["ring", "alert"],
  ["error", "alert"],
  ["abort", "alert"],
  ["dead", "alert"],
  ["welcome", "greeting"],
  ["wakeup", "greeting"],
  ["none", "idle"],
  ["sleep", "leave"],
]);

export const ANON = "anon";
const MAX_QUEUE = 32;
const MAX_LOG = 50;
const ALERT_MIN_MS = 1000;
const ALERT_MAX_MS = 15000;
const ALERT_UNSEEN_MS = 2500;
const REFRESH_MS = 30000;
/** Firmware strip limit (kStatusTextMax). */
export const STATUS_MAX = 19;
/** Status TTL sent to the robot; re-sent before it runs out. */
export const STATUS_TTL_S = 300;
const STATUS_RESEND_MS = 240_000;

const ALERT_TEXT = new Map([
  ["ring", "done"],
  ["error", "error"],
  ["abort", "stopped"],
  ["welcome", "hello"],
  ["wakeup", "hello"],
]);

/** @param {string} name */
export function kindOf(name) {
  return KINDS.get(name) ?? null;
}

/**
 * @typedef {{ id: string, label: string, state: string | null, detail: string | null,
 *   stateAt: number, lastSeen: number, attentionSince: number | null }} Client
 * @typedef {{ client: string, label: string, name: string, at: number }} QueueEntry
 */

export class Referee {
  /**
   * @param {{ stateTtlMs?: number, attentionRepeatMs?: number, attentionMaxMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.stateTtlMs = opts.stateTtlMs ?? 300_000;
    this.attentionRepeatMs = opts.attentionRepeatMs ?? 30_000;
    this.attentionMaxMs = opts.attentionMaxMs ?? 900_000;
    /** @type {Map<string, Client>} */
    this.clients = new Map();
    /** @type {QueueEntry[]} */
    this.queue = [];
    /** @type {string | null} */
    this.owner = null;
    /** @type {{ entry: QueueEntry, sentAt: number, seen: boolean } | null} */
    this.playing = null;
    /** What the broker last sent as the steady face (state, none or sleep). */
    this.lastSteady = null;
    this.lastSteadyAt = 0;
    /** Set when the owner re-posts its state; triggers a throttled refresh. */
    this.refreshWanted = false;
    /** The last client left with `sleep` and nobody else is busy. */
    this.sleepWanted = false;
    /** Strip text last sent to the robot, or null before the first send. */
    this.lastStatus = null;
    this.lastStatusAt = 0;
    /** Robot animation from the last poll, or null when unknown. */
    this.robotAnim = null;
    /** @type {{ at: number, text: string }[]} */
    this.log = [];
  }

  /** @param {number} now @param {string} text */
  note(now, text) {
    this.log.push({ at: now, text });
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  /**
   * File one request.
   * @param {{ name: string, client?: string | null, label?: string | null, detail?: string | null }} req
   * @param {number} now
   * @returns {{ ok: true, kind: string } | { ok: false, error: string }}
   */
  request(req, now) {
    const name = req.name;
    const kind = kindOf(name);
    if (!kind) return { ok: false, error: "unknown animation" };

    const id = cleanId(req.client) ?? ANON;
    const label = cleanLabel(req.label) ?? (id === ANON ? ANON : id.slice(0, 8));
    this.expire(now);

    if (kind === "leave") {
      this.clients.delete(id);
      this.dropQueued(id);
      if (this.owner === id) this.owner = null;
      const busy = [...this.clients.values()].some((c) => c.state || c.attentionSince !== null);
      if (!busy) this.sleepWanted = true;
      this.note(now, `${label}: left`);
      return { ok: true, kind };
    }

    const client = this.touch(id, label, now);
    this.sleepWanted = false;
    // Any request from a client means you are back with it.
    if (client.attentionSince !== null && kind !== "attention") {
      client.attentionSince = null;
    }

    switch (kind) {
      case "state":
        if (client.state === name && this.owner === id) this.refreshWanted = true;
        client.state = name;
        client.detail = cleanDetail(req.detail);
        client.stateAt = now;
        if (this.owner === null) this.owner = id;
        break;
      case "idle":
        client.state = null;
        if (this.owner === id) this.owner = null;
        break;
      case "attention":
        // Firmware attention is a wait loop (call, then up to 60 s of
        // waiting), so it is a steady face, not a queued one-shot.
        if (client.attentionSince === null) client.attentionSince = now;
        break;
      case "alert":
        if (name === "ring") {
          client.state = null;
          if (this.owner === id) this.owner = null;
        }
        this.enqueue({ client: id, label, name, at: now });
        break;
      case "greeting":
        if (this.owner === null && this.queue.length === 0 && !this.playing) {
          this.enqueue({ client: id, label, name, at: now });
        } else {
          this.note(now, `${label}: ${name} skipped, face busy`);
          return { ok: true, kind };
        }
        break;
    }
    this.note(now, `${label}: ${name}`);
    return { ok: true, kind };
  }

  /** @param {string} id @param {string} label @param {number} now */
  touch(id, label, now) {
    let client = this.clients.get(id);
    if (!client) {
      client = {
        id,
        label,
        state: null,
        detail: null,
        stateAt: 0,
        lastSeen: now,
        attentionSince: null,
      };
      this.clients.set(id, client);
    }
    client.label = label;
    client.lastSeen = now;
    return client;
  }

  /** @param {QueueEntry} entry */
  enqueue(entry) {
    const dup = this.queue.some((q) => q.client === entry.client && q.name === entry.name);
    if (dup) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push(entry);
  }

  /** @param {string} id @param {string} [name] */
  dropQueued(id, name) {
    this.queue = this.queue.filter((q) => !(q.client === id && (!name || q.name === name)));
  }

  /** End stale states and attentions, hand the face on. @param {number} now */
  expire(now) {
    for (const client of this.clients.values()) {
      if (client.state && now - client.stateAt >= this.stateTtlMs) {
        this.note(now, `${client.label}: ${client.state} timed out`);
        client.state = null;
      }
      if (client.attentionSince !== null && now - client.attentionSince >= this.attentionMaxMs) {
        this.note(now, `${client.label}: attention gave up`);
        client.attentionSince = null;
      }
    }
    if (this.owner !== null && !this.clients.get(this.owner)?.state) this.owner = null;
    if (this.owner === null) this.owner = this.nextOwner();
  }

  nextOwner() {
    let best = null;
    for (const client of this.clients.values()) {
      if (client.state && (!best || client.stateAt > best.stateAt)) best = client;
    }
    return best?.id ?? null;
  }

  /** Clients waiting for you, oldest first. */
  waiting() {
    return [...this.clients.values()]
      .filter((c) => c.attentionSince !== null)
      .sort((a, b) => /** @type {number} */ (a.attentionSince) - /** @type {number} */ (b.attentionSince));
  }

  /**
   * The robot reported `anim` (or null when unreachable).
   * @param {string | null} anim
   */
  observe(anim) {
    this.robotAnim = anim;
    if (this.playing && anim === this.playing.entry.name) this.playing.seen = true;
  }

  /**
   * What to send the robot now, or null. Call after each poll and request.
   * The caller must call `sent(name, now)` once the robot accepted it.
   * @param {number} now
   * @returns {string | null}
   */
  next(now) {
    this.expire(now);

    if (this.playing) {
      const age = now - this.playing.sentAt;
      // The robot may still be in its 1 s hold of the previous face, so the
      // alert is over only once it was seen running and then left.
      // An alert never seen (the robot dropped it, e.g. wakeup while awake)
      // stops blocking the queue after ALERT_UNSEEN_MS.
      const { seen } = this.playing;
      const moved = seen && this.robotAnim !== null && this.robotAnim !== this.playing.entry.name;
      const done = seen ? moved || age >= ALERT_MAX_MS : age >= ALERT_UNSEEN_MS;
      if (age < ALERT_MIN_MS || !done) return null;
      this.playing = null;
      // The alert replaced the steady face; send it again.
      this.lastSteady = null;
    }

    if (this.queue.length > 0) return this.queue[0].name;

    const steady = this.steadyFace();
    if (steady === null) return null;
    if (steady !== this.lastSteady) return steady;
    // The robot ends its attention wait after 60 s; show it again while
    // someone is still waiting for you.
    if (
      steady === "attention" &&
      this.attentionRepeatMs > 0 &&
      this.robotAnim !== null &&
      this.robotAnim !== "attention" &&
      now - this.lastSteadyAt >= this.attentionRepeatMs
    ) {
      return steady;
    }
    if (this.refreshWanted && now - this.lastSteadyAt >= REFRESH_MS) return steady;
    return null;
  }

  /**
   * Steady face: `attention` while any client waits for you; else the
   * owner's state; `sleep` after the last busy client left; `none` once a
   * face the broker drove has ended. Null leaves the robot's own loop alone
   * (nothing to undo, e.g. after a one-shot fell back to none).
   */
  steadyFace() {
    if (this.waiting().length > 0) return "attention";
    if (this.owner !== null) return this.clients.get(this.owner)?.state ?? null;
    if (this.sleepWanted) return "sleep";
    const last = this.lastSteady === null ? null : kindOf(this.lastSteady);
    if (last === "state" || last === "attention") return "none";
    return null;
  }

  /**
   * The robot accepted `name`.
   * @param {string} name
   * @param {number} now
   */
  sent(name, now) {
    const head = this.queue[0];
    if (head && head.name === name) {
      this.queue.shift();
      this.playing = { entry: head, sentAt: now, seen: this.robotAnim === name };
      return;
    }
    this.lastSteady = name;
    this.lastSteadyAt = now;
    this.refreshWanted = false;
  }

  /**
   * Strip text for the face the robot shows (or is about to): who + what.
   * Empty clears the strip, so the robot shows its own label (`...` idle).
   */
  statusText() {
    const entry = this.playing?.entry ?? this.queue[0];
    if (entry) {
      const what = ALERT_TEXT.get(entry.name);
      return what ? fit(`${entry.label}: ${what}`) : "";
    }
    const waiting = this.waiting();
    if (waiting.length === 1) return fit(`${waiting[0].label} NEEDS YOU`);
    if (waiting.length > 1) return `${waiting.length} NEED YOU`;
    // The owner is handed on in expire(); look ahead so the text never lags.
    const ownerId = this.owner ?? this.nextOwner();
    const owner = ownerId ? this.clients.get(ownerId) : null;
    if (owner?.state) return fit(`${owner.label}: ${owner.detail ?? owner.state}`);
    return "";
  }

  /**
   * Strip text to send now, or null. Call after the animation writes; the
   * caller must call `statusSent(text, now)` afterwards (also on failure,
   * so an old firmware without POST /status is not hammered).
   * @param {number} now
   */
  nextStatus(now) {
    const text = this.statusText();
    if (text !== this.lastStatus) return text;
    if (text && now - this.lastStatusAt >= STATUS_RESEND_MS) return text;
    return null;
  }

  /** @param {string} text @param {number} now */
  statusSent(text, now) {
    this.lastStatus = text;
    this.lastStatusAt = now;
  }

  /** Snapshot for GET /state. @param {number} now */
  snapshot(now) {
    this.expire(now);
    const ownerClient = this.owner ? this.clients.get(this.owner) : null;
    return {
      robot: this.robotAnim,
      owner: ownerClient ? { id: ownerClient.id, label: ownerClient.label } : null,
      playing: this.playing ? { label: this.playing.entry.label, name: this.playing.entry.name } : null,
      clients: [...this.clients.values()].map((c) => ({
        id: c.id,
        label: c.label,
        state: c.state,
        detail: c.detail,
        attention: c.attentionSince !== null,
        idleS: Math.round((now - c.lastSeen) / 1000),
      })),
      waiting: this.waiting().map((c) => c.label),
      status: this.statusText(),
      queue: this.queue.map((q) => ({ label: q.label, name: q.name })),
      log: this.log.slice(),
    };
  }
}

/** @param {unknown} value */
function cleanId(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && v.length <= 64 ? v : null;
}

/** @param {unknown} value */
function cleanDetail(value) {
  if (typeof value !== "string") return null;
  const v = value.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 40);
  return v || null;
}

/**
 * Cut to the strip width; `label: detail` loses the end of the detail.
 * @param {string} text
 */
function fit(text) {
  return text.length <= STATUS_MAX ? text : text.slice(0, STATUS_MAX);
}

/** @param {unknown} value */
function cleanLabel(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, 20);
  return v || null;
}
