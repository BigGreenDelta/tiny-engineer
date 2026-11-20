import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "te-cc-namer-"));
process.env.CC_NAMER_STATE_DIR = dir;
const { sessionName } = await import("../src/integrations/claude-code/session-name.js");

test("sessionName reads cc-namer's state file, null when missing", () => {
  mkdirSync(join(dir, "sessions"));
  writeFileSync(join(dir, "sessions", "abc-1.json"), JSON.stringify({ name: "oled-strip", title: "@14:55 oled-strip" }));
  writeFileSync(join(dir, "sessions", "bad.json"), "{");
  assert.equal(sessionName("abc-1"), "oled-strip");
  assert.equal(sessionName("missing"), null);
  assert.equal(sessionName("bad"), null);
  assert.equal(sessionName(""), null);
});
