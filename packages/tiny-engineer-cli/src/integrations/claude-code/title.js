/**
 * Session title with a prompt-cache mark, for Claude Code's session list,
 * `claude agents`, Orca and the terminal tab:
 *
 *   @14:35 oled-strip   cache warm until at least 14:35 (local time)
 *   [C] oled-strip      resumed session whose cache has already expired
 *
 * Hooks fire only on events, so the title carries the expiry clock time
 * instead of a countdown: a clock time never goes stale. Past that time the
 * cache is cold.
 *
 * - UserPromptSubmit: expiry = now + TTL. The turn's last request refreshes
 *   the cache later than that, so the mark errs early, never late.
 * - SessionStart (resume): expiry = last assistant message + TTL, or [C].
 * - The mark is shown MARGIN early (5 min) as a safety margin, so a prompt
 *   sent right at the mark still hits warm cache. With a TTL no longer than
 *   the margin (5 min under overage) the mark is the exact expiry.
 * - TTL comes from the transcript: the latest request that wrote cache says
 *   whether it wrote 1 h or 5 min entries (5 min under usage overage).
 * - The name part is the Haiku name from naming.js, else the folder. A
 *   /rename by the user wins: their name stays, only the mark changes.
 *
 * Runs as its own synchronous hook (`tiny-engineer session-title
 * claude-code`): the robot hook is async, and Claude Code ignores the output
 * of async hooks.
 */
import { readFileSync } from "node:fs";

import { readNameState, writeNameState } from "./naming.js";

const HOUR_MS = 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const MARGIN_MS = 5 * 60 * 1000;
/** Bytes read from the end of the transcript to find the TTL. */
const TAIL_BYTES = 2 * 1024 * 1024;
/** Our mark; the older `[@14:35]` form too, so old titles get replaced. */
const MARK_RE = /^(?:@\d{1,2}:\d{2}|\[(?:@\d{1,2}:\d{2}|C)\])\s*/;

/** @param {string} title */
export function stripMark(title) {
  return String(title ?? "").replace(MARK_RE, "").trim();
}

/** @param {number} ms */
export function clockMark(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `@${hh}:${mm}`;
}

/**
 * Facts the title needs from a transcript (JSONL).
 * @param {string} text
 * @returns {{ ttlMs: number | null, lastAssistantMs: number | null, customTitle: string | null }}
 */
export function transcriptFacts(text) {
  let customTitle = null;
  const at = text.lastIndexOf('"type":"custom-title"');
  if (at !== -1) {
    const start = text.lastIndexOf("\n", at) + 1;
    const end = text.indexOf("\n", at);
    try {
      const entry = JSON.parse(text.slice(start, end === -1 ? undefined : end));
      if (typeof entry.customTitle === "string") customTitle = entry.customTitle;
    } catch {
      // half-written line
    }
  }

  let ttlMs = null;
  let lastAssistantMs = null;
  const tail = text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text;
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0 && ttlMs === null; i--) {
    const line = lines[i];
    if (!line.includes('"type":"assistant"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    if (lastAssistantMs === null) {
      const ts = Date.parse(entry.timestamp);
      if (Number.isFinite(ts)) lastAssistantMs = ts;
    }
    const cc = entry.message?.usage?.cache_creation;
    const oneHour = Number(cc?.ephemeral_1h_input_tokens) || 0;
    const fiveMin = Number(cc?.ephemeral_5m_input_tokens) || 0;
    if (oneHour > 0) ttlMs = HOUR_MS;
    else if (fiveMin > 0) ttlMs = FIVE_MIN_MS;
  }
  return { ttlMs, lastAssistantMs, customTitle };
}

/** TTL override in minutes, for testing or a known plan. */
function envTtlMs() {
  const min = Number(process.env.TINY_ENGINEER_CACHE_TTL_MIN);
  return Number.isFinite(min) && min > 0 ? min * 60 * 1000 : null;
}

/**
 * The title for a hook event, or null to leave the title alone.
 * Updates the session's state file (its `title` and `manualName`).
 * @param {Record<string, unknown>} raw hook payload
 * @param {number} [now]
 * @returns {string | null}
 */
export function titleForEvent(raw, now = Date.now()) {
  const event = raw?.hook_event_name;
  const sessionId = typeof raw?.session_id === "string" ? raw.session_id : "";
  if (!sessionId) return null;
  if (event !== "UserPromptSubmit" && !(event === "SessionStart" && raw.source === "resume")) {
    return null;
  }

  let text = "";
  if (typeof raw.transcript_path === "string" && raw.transcript_path) {
    try {
      text = readFileSync(raw.transcript_path, "utf8");
    } catch {
      text = "";
    }
  }
  const facts = transcriptFacts(text);
  const ttlMs = envTtlMs() ?? facts.ttlMs ?? HOUR_MS;
  // Shown expiry = real expiry minus the safety margin.
  const shownMs = ttlMs > MARGIN_MS ? ttlMs - MARGIN_MS : ttlMs;

  const state = readNameState(sessionId);
  // A title without our mark is the user's /rename: keep their name. One
  // with the mark is ours, even when the state file is new or was pruned.
  if (facts.customTitle !== null && !MARK_RE.test(facts.customTitle)) {
    const base = facts.customTitle.trim();
    if (base) state.manualName = base;
  }
  const cwd = typeof raw.cwd === "string" ? raw.cwd : "";
  const folder = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  const name = state.manualName ?? state.name ?? folder;

  let mark;
  if (event === "UserPromptSubmit") {
    mark = clockMark(now + shownMs);
  } else if (facts.lastAssistantMs === null || facts.lastAssistantMs + shownMs <= now) {
    mark = "[C]";
  } else {
    mark = clockMark(facts.lastAssistantMs + shownMs);
  }

  const title = name ? `${mark} ${name}` : mark;
  state.title = title;
  writeNameState(sessionId, state);
  return title;
}

/**
 * Hook entry point: prints the Claude Code hook JSON with the title. Never
 * throws; prints nothing when there is nothing to set.
 * @param {string} stdinText
 */
export function runSessionTitle(stdinText) {
  try {
    const raw = JSON.parse(stdinText);
    const title = titleForEvent(raw);
    if (!title) return;
    process.stdout.write(
      `${JSON.stringify({ hookSpecificOutput: { hookEventName: raw.hook_event_name, sessionTitle: title } })}\n`,
    );
  } catch {
    // A title is a nicety; the hook must never fail because of it.
  }
}
