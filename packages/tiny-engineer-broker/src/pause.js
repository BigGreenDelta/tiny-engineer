import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Longest timed pause: one week. */
export const PAUSE_MAX_S = 7 * 24 * 3600;

/**
 * Pause switch: while it is on, the broker sends the robot nothing (see
 * docs/broker.md, Pause). `until` null means until resume. With a file path
 * the switch survives a broker restart.
 */
export class Pause {
  /** @param {{ file?: string | null }} [opts] */
  constructor(opts = {}) {
    this.file = opts.file ?? null;
    /** @type {number | null} */
    this.since = null;
    /** @type {number | null} */
    this.until = null;
    this.load();
  }

  load() {
    if (!this.file) return;
    let saved;
    try {
      saved = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return; // no file (not paused) or unreadable: start unpaused
    }
    if (typeof saved?.since !== "number") return;
    this.since = saved.since;
    this.until = typeof saved.until === "number" ? saved.until : null;
  }

  save() {
    if (!this.file) return;
    try {
      if (this.since === null) {
        rmSync(this.file, { force: true });
        return;
      }
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.new`;
      writeFileSync(tmp, JSON.stringify({ since: this.since, until: this.until }));
      renameSync(tmp, this.file);
    } catch {
      // A read-only or missing volume only loses the pause on restart.
    }
  }

  /**
   * Turn the switch on, or move its end. `seconds` null: until resume.
   * @param {number} now
   * @param {number | null} seconds
   */
  start(now, seconds) {
    if (this.since === null || !this.active(now)) this.since = now;
    this.until = seconds === null ? null : now + seconds * 1000;
    this.save();
  }

  /** Turn the switch off. @returns {boolean} whether it was on */
  stop() {
    const was = this.since !== null;
    this.since = null;
    this.until = null;
    this.save();
    return was;
  }

  /** On at `now`? A timed pause that ran out counts as off. @param {number} now */
  active(now) {
    if (this.since === null) return false;
    return this.until === null || now < this.until;
  }

  /** @param {number} now */
  view(now) {
    return this.active(now) ? { since: this.since, until: this.until } : null;
  }
}

/**
 * `for_s` from a POST /pause body: a whole number of seconds, 1 to a week,
 * or absent for "until resume".
 * @param {unknown} body
 * @returns {{ ok: true, seconds: number | null } | { ok: false, error: string }}
 */
export function pauseSeconds(body) {
  if (body === null || body === undefined) return { ok: true, seconds: null };
  if (typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const value = /** @type {{ for_s?: unknown }} */ (body).for_s;
  if (value === undefined || value === null) return { ok: true, seconds: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > PAUSE_MAX_S) {
    return { ok: false, error: `for_s must be a whole number of seconds, 1 to ${PAUSE_MAX_S}` };
  }
  return { ok: true, seconds: value };
}
