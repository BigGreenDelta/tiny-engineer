import { formatFileModifications } from "./files.js";
import {
  applyInstall,
  applyUninstall,
  configRelativePath,
  detect,
  planInstall,
  planUninstall,
} from "./install.js";
import { animationForEvent } from "./map.js";

/**
 * @param {string} stdinText
 * @returns {Record<string, unknown> | null}
 */
function parseStdinJson(stdinText) {
  if (!stdinText.trim()) return null;
  try {
    return JSON.parse(stdinText);
  } catch {
    return null;
  }
}

/** Last path segment. @param {unknown} path */
function baseName(path) {
  if (typeof path !== "string" || !path) return "";
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
}

/**
 * Program (+ subcommand) of a shell command, skipping `VAR=value` and `cd x &&`
 * prefixes. Never more: arguments can hold secrets.
 * @param {unknown} command
 */
function shellProgram(command) {
  if (typeof command !== "string") return "";
  const segments = command.split(/&&|\|\||;|\|/).map((p) => p.trim()).filter(Boolean);
  const seg = segments.find((p) => !/^cd(\s|$)/.test(p)) ?? segments[0] ?? "";
  const words = seg.split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const prog = baseName(words[0] ?? "");
  const sub = words[1] && /^[a-z][a-z0-9-]*$/.test(words[1]) ? ` ${words[1]}` : "";
  return prog ? `${prog}${sub}` : "";
}

/**
 * Short "what" for the robot's status strip, from a PreToolUse payload:
 * `Edit oled.cpp`, `Bash pio run`, `Grep handleAnim`.
 * @param {Record<string, unknown> | undefined} raw
 * @returns {string | undefined}
 */
export function toolDetail(raw) {
  if (raw?.hook_event_name !== "PreToolUse") return undefined;
  const tool = typeof raw.tool_name === "string" ? raw.tool_name : "";
  const input = /** @type {Record<string, unknown>} */ (raw.tool_input ?? {});
  let arg = "";
  switch (tool) {
    case "Read":
    case "Edit":
    case "Write":
      arg = baseName(input.file_path);
      break;
    case "NotebookEdit":
      arg = baseName(input.notebook_path);
      break;
    case "Bash":
    case "PowerShell":
      arg = shellProgram(input.command);
      break;
    case "Grep":
    case "Glob":
      arg = typeof input.pattern === "string" ? input.pattern : "";
      break;
    case "WebFetch":
      try {
        arg = new URL(String(input.url)).hostname;
      } catch {
        arg = "";
      }
      break;
    default:
      arg = "";
  }
  if (!tool) return undefined;
  const label = tool === "WebFetch" ? "Fetch" : tool === "WebSearch" ? "Search" : tool;
  return arg ? `${label} ${arg}` : label;
}

/** @type {import("../types.js").Integration} */
export const claudeCode = {
  id: "claude-code",
  name: "Claude Code",
  hardExitAfterPost: true,

  /**
   * @param {string[]} _argv
   * @param {string} stdinText
   */
  parseHook(_argv, stdinText) {
    const event = parseStdinJson(stdinText);
    if (!event || typeof event !== "object") return null;

    const name = event.hook_event_name;
    if (typeof name !== "string" || !name) return null;

    return {
      event: name,
      tool: typeof event.tool_name === "string" ? event.tool_name : undefined,
      status: typeof event.status === "string" ? event.status : undefined,
      meta: {
        source: event.source,
        reason: event.reason,
        raw: event,
      },
    };
  },

  /**
   * Who is asking, for the Tiny Engineer Broker: the session id, labelled with the
   * project folder name.
   * @param {import("../types.js").HookInput} input
   */
  requester(input) {
    const raw = /** @type {Record<string, unknown> | undefined} */ (input.meta?.raw);
    const client = typeof raw?.session_id === "string" ? raw.session_id : undefined;
    if (!client) return null;
    const cwd = typeof raw?.cwd === "string" ? raw.cwd : "";
    const label = cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || undefined;
    return { client, label, detail: toolDetail(raw) };
  },

  /**
   * @param {import("../types.js").HookInput} input
   */
  mapToAnim(input) {
    const raw = input.meta?.raw;
    if (raw && typeof raw === "object") {
      return animationForEvent(
        /** @type {Parameters<typeof animationForEvent>[0]} */ (raw),
      );
    }
    return animationForEvent({
      hook_event_name: input.event,
      tool_name: input.tool,
      source: typeof input.meta?.source === "string" ? input.meta.source : undefined,
      reason: typeof input.meta?.reason === "string" ? input.meta.reason : undefined,
    });
  },

  /**
   * @param {import("../types.js").HookInput} input
   * @param {import("../../util/style.js").Style} style
   */
  describeFiles(input, style) {
    const raw = input.meta?.raw;
    if (!raw || typeof raw !== "object") return [];
    return formatFileModifications(/** @type {Record<string, unknown>} */ (raw), style);
  },

  // Claude Code adds SessionStart / UserPromptSubmit stdout to the model context.
  respond() {},

  detect,
  configRelativePath,
  planInstall,
  applyInstall,
  planUninstall,
  applyUninstall,
};
