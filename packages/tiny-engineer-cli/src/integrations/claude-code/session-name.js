/**
 * Session names come from cc-namer (https://github.com/BigGreenDelta/cc-namer),
 * a separate Claude Code hook that names sessions with Haiku. Tiny Engineer
 * only reads the name from cc-namer's per-session state file:
 *
 *   $CC_NAMER_STATE_DIR/sessions/<session id>.json   field `name`
 *   (default dir: $XDG_STATE_HOME/cc-namer, else ~/.local/state/cc-namer)
 *
 * No cc-namer, no file, or no name yet: null, and the hook falls back to
 * the project folder.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Set by cc-namer in its own `claude -p` naming run: our hook stays out. */
export const CC_NAMER_CHILD_ENV = "CC_NAMER_CHILD";

function ccNamerStateDir() {
  const fromEnv = process.env.CC_NAMER_STATE_DIR?.trim();
  if (fromEnv) return fromEnv;
  const xdg = process.env.XDG_STATE_HOME?.trim();
  return join(xdg || join(homedir(), ".local", "state"), "cc-namer");
}

/**
 * @param {string} sessionId
 * @returns {string | null}
 */
export function sessionName(sessionId) {
  if (!sessionId) return null;
  try {
    const file = join(ccNamerStateDir(), "sessions", `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
    const name = JSON.parse(readFileSync(file, "utf8")).name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
