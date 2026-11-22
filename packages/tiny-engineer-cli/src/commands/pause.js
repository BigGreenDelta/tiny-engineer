import { execFile } from "node:child_process";

import {
  getBaseUrl,
  getConnectionProvenance,
  getHttpAuthToken,
  resolveTransport,
} from "../config/env.js";
import { networkErrorDetail, robotFetch } from "../robot/client.js";
import { parseCommonArgs } from "../util/args.js";
import { readStdin } from "../util/stdin.js";

/** Same limit as the broker's POST /pause (one week). */
export const PAUSE_MAX_S = 7 * 24 * 3600;
const TIMEOUT_MS = 3000;
/** `op read` may wait for an unlock prompt. */
const TOKEN_STDIN_TIMEOUT_MS = 60_000;

/** 1Password reference (op://vault/item/field) to the broker's TE_BROKER_TOKEN. */
export const BROKER_TOKEN_REF_KEY = "TINY_ENGINEER_BROKER_TOKEN_REF";
/** `op` may wait for an unlock prompt. */
const OP_TIMEOUT_MS = 60_000;

const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Parse a duration such as `90s`, `30m`, `2h`, `1h30m` or `1d` to seconds.
 * A bare number is refused: minutes or seconds would be a guess.
 * @param {string} text
 * @returns {{ seconds: number, error?: undefined } | { seconds?: undefined, error: string }}
 */
export function parseDuration(text) {
  const value = String(text ?? "").trim().toLowerCase();
  const usage = `invalid duration "${text}" (use e.g. 90s, 30m, 2h, 1h30m, 1d)`;
  if (!/^(\d+[smhd])+$/.test(value)) return { error: usage };
  let seconds = 0;
  for (const [, n, unit] of value.matchAll(/(\d+)([smhd])/g)) {
    seconds += Number(n) * UNITS[/** @type {keyof typeof UNITS} */ (unit)];
  }
  if (seconds < 1) return { error: usage };
  if (seconds > PAUSE_MAX_S) return { error: `duration "${text}" is over the 7-day limit` };
  return { seconds };
}

/**
 * @param {number} ms
 * @returns {string} e.g. `1h05m`, `12m`, `40s`
 */
export function formatLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h${String(m).padStart(2, "0")}m` : `${h}h`;
}

/**
 * Args for pause / resume / status: the common flags plus `--for <duration>`
 * (pause only) and `--token-stdin`.
 * @param {string[]} argv
 * @param {{ allowFor?: boolean }} [opts]
 */
export function parsePauseArgs(argv, opts = {}) {
  /** @type {string | undefined} */
  let forText;
  let tokenStdin = false;
  /** @type {string[]} */
  const filtered = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (opts.allowFor && arg === "--for") {
      const next = argv[++i];
      if (!next) return { ...parseCommonArgs([]), error: "--for requires a duration, e.g. --for 30m" };
      forText = next;
      continue;
    }
    if (opts.allowFor && arg.startsWith("--for=")) {
      forText = arg.slice("--for=".length);
      continue;
    }
    if (arg === "--token-stdin") {
      tokenStdin = true;
      continue;
    }
    filtered.push(arg);
  }
  const common = parseCommonArgs(filtered);
  if (common.error) return { ...common, tokenStdin };
  if (common.rest.length) return { ...common, tokenStdin, error: `Unknown argument: ${common.rest[0]}` };
  /** @type {number | null} */
  let seconds = null;
  if (forText !== undefined) {
    const parsed = parseDuration(forText);
    if (parsed.error) return { ...common, tokenStdin, error: parsed.error };
    seconds = /** @type {number} */ (parsed.seconds);
  }
  return { ...common, tokenStdin, seconds };
}

/**
 * Read a secret reference with the 1Password CLI, in memory only.
 * @param {string} ref
 * @param {{ execFileImpl?: typeof execFile }} [opts]
 * @returns {Promise<{ token: string, error?: undefined } | { token?: undefined, error: string }>}
 */
export function opRead(ref, { execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl("op", ["read", "--no-newline", ref], { timeout: OP_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        const why = String(stderr || "").trim() || (err instanceof Error ? err.message : String(err));
        resolve({ error: `${BROKER_TOKEN_REF_KEY}: op read failed: ${why}` });
        return;
      }
      const token = String(stdout).trim();
      resolve(token ? { token } : { error: `${BROKER_TOKEN_REF_KEY}: op read returned nothing` });
    });
  });
}

/**
 * The token for the broker's control routes: --token-stdin, else
 * TINY_ENGINEER_TOKEN, else TINY_ENGINEER_BROKER_TOKEN_REF read with `op`.
 * The reference is not used against a URL that came only from a project .env.
 * @param {{ tokenStdin?: boolean, url?: string }} opts
 * @param {{ readStdinImpl?: typeof readStdin, opReadImpl?: typeof opRead }} [deps]
 * @returns {Promise<{ token: string | null, error?: string }>}
 */
export async function brokerToken(opts, deps = {}) {
  const { readStdinImpl = readStdin, opReadImpl = opRead } = deps;
  if (opts.tokenStdin) {
    const token = (await readStdinImpl({ timeoutMs: TOKEN_STDIN_TIMEOUT_MS })).trim();
    return token ? { token } : { token: null, error: "--token-stdin: nothing on stdin" };
  }
  const token = getHttpAuthToken({ urlOverride: opts.url !== undefined });
  if (token) return { token };
  const ref = process.env[BROKER_TOKEN_REF_KEY]?.trim();
  if (!ref) return { token: null };
  if (opts.url === undefined && getConnectionProvenance().url === "project") {
    process.stderr.write(`warning: not reading ${BROKER_TOKEN_REF_KEY} for a TINY_ENGINEER_URL from project .env\n`);
    return { token: null };
  }
  const read = await opReadImpl(ref);
  return read.error ? { token: null, error: read.error } : { token: /** @type {string} */ (read.token) };
}

/**
 * Call a broker pause route. Never throws.
 * @param {"GET" | "POST"} method
 * @param {string} path
 * @param {{ url?: string, token?: string | null, body?: unknown }} opts
 * @returns {Promise<{ ok: true, body: Record<string, unknown>, target: string } | { ok: false, error: string, target: string }>}
 */
export async function brokerCall(method, path, opts) {
  const target = opts.url ?? getBaseUrl();
  /** @type {RequestInit} */
  const init = { method, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (opts.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await robotFetch(target, path, init, opts.token ?? null);
  } catch (err) {
    return { ok: false, error: `broker unreachable: ${networkErrorDetail(err)}`, target };
  }
  /** @type {Record<string, unknown>} */
  let body = {};
  try {
    body = await res.json();
  } catch {
    // not JSON: the status says enough
  }
  if (res.status === 404) {
    return {
      ok: false,
      error: `${target} has no ${path}: pause needs TINY_ENGINEER_URL (or --url) pointed at the Tiny Engineer Broker, not the robot (docs/broker.md)`,
      target,
    };
  }
  if (res.status === 401) {
    return {
      ok: false,
      error: `broker refused: needs its TE_BROKER_TOKEN (set ${BROKER_TOKEN_REF_KEY}=op://... in the user config, or TINY_ENGINEER_TOKEN, or pipe it in with --token-stdin)`,
      target,
    };
  }
  if (!res.ok || body.ok === false) {
    const why = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    return { ok: false, error: `broker: ${why}`, target };
  }
  return { ok: true, body, target };
}

/**
 * One line for a GET /pause style reply.
 * @param {Record<string, unknown>} body
 * @param {number} [now]
 */
export function describePause(body, now = Date.now()) {
  if (!body.paused) return "not paused: agent activity animates the robot";
  const since = typeof body.since === "number" ? ` (since ${clock(body.since)})` : "";
  if (typeof body.until !== "number") return `paused until resume${since}`;
  return `paused until ${clock(body.until)}, ${formatLeft(body.until - now)} left${since}`;
}

/** @param {number} ms */
function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * @param {import("../util/output.js").Output} out
 * @param {"pause" | "resume" | "status"} command
 * @param {string[]} argv
 * @param {boolean} quietGlobal
 */
export async function runPauseCommand(out, command, argv, quietGlobal) {
  const opts = parsePauseArgs(argv, { allowFor: command === "pause" });
  const quiet = quietGlobal || opts.quiet;
  if (opts.help) {
    console.log(`Usage:
  tiny-engineer pause [--for <duration>]   Stop agent activity animating the robot
  tiny-engineer resume                     Let it animate again
  tiny-engineer status                     Paused or not, and until when

Talks to the Tiny Engineer Broker at TINY_ENGINEER_URL (docs/broker.md). The
robot's own API (servo tests, setup) keeps working while paused.

Options:
  --for <duration>   pause only: resume by itself after 90s, 30m, 2h, 1h30m, 1d (max 7d)
  --token-stdin      read the broker's TE_BROKER_TOKEN from stdin; else TINY_ENGINEER_TOKEN,
                     else TINY_ENGINEER_BROKER_TOKEN_REF (op://..., read with the 1Password CLI)
  --url <base>       broker base URL
  -q, --quiet        no success line
`);
    return;
  }
  if (opts.error) {
    out.error(opts.error);
    process.exitCode = 1;
    return;
  }
  const transport = resolveTransport(opts.transport);
  if (transport.error) {
    out.error(transport.error);
    process.exitCode = 1;
    return;
  }
  if (transport.transport === "serial" && opts.transport !== undefined) {
    out.error(`${command} needs HTTP: the pause lives in the Tiny Engineer Broker, not on the USB link`);
    process.exitCode = 1;
    return;
  }

  // status reads GET /pause, which needs no token: skip the op prompt.
  const auth = command === "status" ? { token: null } : await brokerToken(opts);
  if (auth.error) {
    out.error(auth.error);
    process.exitCode = 1;
    return;
  }
  const token = auth.token;

  const result =
    command === "status"
      ? await brokerCall("GET", "/pause", { url: opts.url, token })
      : command === "pause"
        ? await brokerCall("POST", "/pause", {
            url: opts.url,
            token,
            body: opts.seconds ? { for_s: opts.seconds } : {},
          })
        : await brokerCall("POST", "/resume", { url: opts.url, token });
  if (!result.ok) {
    out.error(result.error);
    process.exitCode = 1;
    return;
  }

  let line = describePause(result.body);
  if (command === "resume" && result.body.was_paused === false) line = "was not paused";
  if (command === "status" || !quiet) console.log(`${line} (${out.style.dim(result.target)})`);
  process.exitCode = 0;
}
