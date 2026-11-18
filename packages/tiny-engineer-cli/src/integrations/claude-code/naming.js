/**
 * Session names for the robot's status strip, chosen by the local `claude`
 * (Haiku) from the user's own prompts. Runs on this machine only: prompts
 * go to Claude through the same CLI the session already uses, and the
 * broker only ever sees the resulting name (sent as `label`).
 *
 * - First prompt of a session: name it.
 * - Every NAME_EVERY prompts: show Haiku the current name and the last
 *   NAME_WINDOW prompts; it keeps the name unless the topic clearly moved.
 *   A rename needs two checks in a row that say so (one side trip does not
 *   rename the session); the second check's name wins.
 * - The hook never waits: naming runs in a detached child process
 *   (`tiny-engineer name-session`), which writes the per-session state file
 *   the hook reads on its next event.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { userConfigDir } from "../../config/paths.js";

export const NAME_EVERY = 10;
export const NAME_WINDOW = 10;
export const NAME_MAX = 12;
const PROMPT_CHARS = 300;
const NAMING_STALE_MS = 2 * 60 * 1000;
const STATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CLAUDE_TIMEOUT_MS = 90 * 1000;
/** Set in the naming child's environment: our hook does nothing there. */
export const SKIP_ENV = "TINY_ENGINEER_HOOK_SKIP";

/**
 * @typedef {{ prompts: number, name: string | null, namingSince: number | null,
 *   pending: string | null, updatedAt: number }} NameState
 */

export function sessionsDir() {
  return join(userConfigDir(), "sessions");
}

/** @param {string} sessionId */
function statePath(sessionId) {
  return join(sessionsDir(), `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

/**
 * @param {string} sessionId
 * @returns {NameState}
 */
export function readNameState(sessionId) {
  try {
    const data = JSON.parse(readFileSync(statePath(sessionId), "utf8"));
    return {
      prompts: Number.isInteger(data.prompts) ? data.prompts : 0,
      name: typeof data.name === "string" && data.name ? data.name : null,
      namingSince: typeof data.namingSince === "number" ? data.namingSince : null,
      pending: typeof data.pending === "string" && data.pending ? data.pending : null,
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    };
  } catch {
    return { prompts: 0, name: null, namingSince: null, pending: null, updatedAt: 0 };
  }
}

/**
 * @param {string} sessionId
 * @param {NameState} state
 */
export function writeNameState(sessionId, state) {
  const dir = sessionsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = statePath(sessionId);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: Date.now() }), { mode: 0o600 });
  renameSync(tmp, path);
}

/** Drop state files of sessions untouched for a month. */
function pruneStates() {
  try {
    const dir = sessionsDir();
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (now - statSync(p).mtimeMs > STATE_MAX_AGE_MS) unlinkSync(p);
    }
  } catch {
    // best effort
  }
}

/**
 * User prompts from a Claude Code transcript (JSONL), oldest first. Only
 * what the user typed: tool results, command echoes and system notes are
 * skipped.
 * @param {string} transcriptPath
 * @returns {string[]}
 */
export function promptsFromTranscript(transcriptPath) {
  let text;
  try {
    text = readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "user" || entry.isMeta) continue;
    const content = entry.message?.content;
    let prompt = "";
    if (typeof content === "string") prompt = content;
    else if (Array.isArray(content)) {
      // Tool results are user entries too; a typed prompt has text blocks only.
      if (content.some((b) => b?.type === "tool_result")) continue;
      prompt = content
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n");
    }
    prompt = cleanPrompt(prompt);
    if (prompt) out.push(prompt);
  }
  return out;
}

/** @param {string} prompt */
function cleanPrompt(prompt) {
  const p = prompt.trim();
  if (!p) return "";
  // Slash-command echoes, local command output, reminders, interrupts.
  if (/^<(command-|local-command|system-reminder|bash-|user-memory)/.test(p)) return "";
  if (/^\[Request interrupted/.test(p) || /^Caveat:/.test(p)) return "";
  return p.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim().slice(0, PROMPT_CHARS);
}

/**
 * Clean a model reply into a name, "keep", or null when unusable.
 * @param {string} reply
 * @returns {string | null}
 */
export function parseNameReply(reply) {
  const first = String(reply ?? "").trim().split("\n")[0]?.trim().toLowerCase() ?? "";
  const line = first.replace(/^["'`*]+|["'`*.]+$/g, "");
  if (line === "keep") return "keep";
  const words = line
    .split(/[\s_-]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return null;
  // A phrase instead of a name ("ESP32 VN pin wiring"): its first two words.
  for (const take of [words.length, 2, 1]) {
    const name = words.slice(0, take).join("-");
    if (name.length <= NAME_MAX) return name;
  }
  return words[0].slice(0, NAME_MAX);
}

/**
 * The instruction for Haiku.
 * @param {string | null} current
 * @param {string[]} prompts
 */
export function namingPrompt(current, prompts) {
  const list = prompts.map((p, i) => `[${i + 1}] ${p}`).join("\n\n");
  const rules = `A name is 1 or 2 lowercase English words; two words are joined by a hyphen (like oled-strip, wiki-fix, broker). At most ${NAME_MAX} characters.`;
  return [
    "You name a coding-assistant session for a tiny status display on a desk robot.",
    "The user's latest prompts in this session, oldest first:",
    "<prompts>",
    list,
    "</prompts>",
    rules,
    current
      ? [
          `The session is currently named "${current}".`,
          "Step 1: decide the main topic of most of these prompts (ignore one-off side questions).",
          `Step 2: if "${current}" describes that topic, reply with exactly: keep`,
          `Otherwise reply with a new name taken from the prompts alone; do not reuse words of "${current}" that no longer fit.`,
        ].join("\n")
      : "Name the main topic of most of these prompts.",
    "Reply with the single word keep or the name, nothing else.",
  ].join("\n");
}

/**
 * Called by the hook on UserPromptSubmit. Counts the prompt and, when a
 * (re)name is due, starts the detached naming child. Never throws, never
 * waits.
 * @param {Record<string, unknown>} raw hook payload
 */
export function notePrompt(raw) {
  try {
    const sessionId = typeof raw.session_id === "string" ? raw.session_id : "";
    if (!sessionId) return;
    const state = readNameState(sessionId);
    state.prompts += 1;
    const due = state.prompts === 1 || state.name === null || state.prompts % NAME_EVERY === 0;
    const busy = state.namingSince !== null && Date.now() - state.namingSince < NAMING_STALE_MS;
    if (!due || busy) {
      writeNameState(sessionId, state);
      return;
    }

    const transcript = typeof raw.transcript_path === "string" ? raw.transcript_path : "";
    const prompts = transcript ? promptsFromTranscript(transcript) : [];
    // The prompt being submitted may not be in the transcript yet.
    const current = typeof raw.prompt === "string" ? cleanPrompt(raw.prompt) : "";
    if (current && prompts.at(-1) !== current) prompts.push(current);
    if (prompts.length === 0) {
      writeNameState(sessionId, state);
      return;
    }

    state.namingSince = Date.now();
    writeNameState(sessionId, state);
    pruneStates();

    const bin = fileURLToPath(new URL("../../../bin/tiny-engineer.js", import.meta.url));
    const child = spawn(process.execPath, [bin, "name-session", sessionId], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      cwd: tmpdir(),
      env: { ...process.env, [SKIP_ENV]: "1" },
    });
    child.stdin.end(JSON.stringify({ current: state.name, prompts: prompts.slice(-NAME_WINDOW) }));
    child.unref();
  } catch {
    // Naming is a nicety; the hook must never fail because of it.
  }
}

/**
 * Child process: ask the local claude for a name and store it.
 * stdin: {"current": string|null, "prompts": string[]}
 * @param {string} sessionId
 * @param {string} stdinText
 * @param {{ claudeBin?: string }} [opts]
 */
export async function runNameSession(sessionId, stdinText, opts = {}) {
  let input;
  try {
    input = JSON.parse(stdinText);
  } catch {
    input = null;
  }
  const prompts = Array.isArray(input?.prompts) ? input.prompts.filter((p) => typeof p === "string") : [];
  const current = typeof input?.current === "string" ? input.current : null;

  let reply = null;
  if (prompts.length > 0) {
    reply = await askClaude(namingPrompt(current, prompts), opts.claudeBin);
  }
  const parsed = reply === null ? null : parseNameReply(reply);

  const state = readNameState(sessionId);
  state.namingSince = null;
  if (parsed === "keep" || parsed === state.name) {
    state.pending = null;
  } else if (parsed) {
    if (state.name === null || state.pending !== null) {
      state.name = parsed;
      state.pending = null;
    } else {
      state.pending = parsed;
    }
  }
  writeNameState(sessionId, state);
  return parsed;
}

/**
 * `claude -p` with Haiku, no tools, nothing saved. Null on any failure.
 * @param {string} prompt
 * @param {string} [claudeBin]
 * @returns {Promise<string | null>}
 */
function askClaude(prompt, claudeBin) {
  const bin = claudeBin || process.env.TINY_ENGINEER_CLAUDE?.trim() || "claude";
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    let proc;
    try {
      proc = spawn(bin, ["-p", "--model", "haiku", "--tools", "", "--no-session-persistence"], {
        stdio: ["pipe", "pipe", "ignore"],
        cwd: tmpdir(),
        env: process.env,
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(null);
    }, CLAUDE_TIMEOUT_MS);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (c) => {
      out += c;
    });
    proc.on("error", () => finish(null));
    proc.on("close", (code) => finish(code === 0 ? out : null));
    proc.stdin.end(prompt);
  });
}

/**
 * Name for the hook's `label`, or null to fall back to the folder.
 * @param {string} sessionId
 */
export function sessionName(sessionId) {
  if (!sessionId || !existsSync(statePath(sessionId))) return null;
  return readNameState(sessionId).name;
}
