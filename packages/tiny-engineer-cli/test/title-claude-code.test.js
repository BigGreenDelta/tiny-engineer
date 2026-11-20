import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "te-title-"));
process.env.TINY_ENGINEER_CONFIG_DIR = dir;
delete process.env.TINY_ENGINEER_CACHE_TTL_MIN;

const title = await import("../src/integrations/claude-code/title.js");
const naming = await import("../src/integrations/claude-code/naming.js");

const T0 = new Date(2026, 10, 20, 14, 0, 0).getTime();
const assistant = (ms, oneHour, fiveMin) =>
  JSON.stringify({
    type: "assistant",
    timestamp: new Date(ms).toISOString(),
    message: {
      usage: {
        cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: fiveMin },
      },
    },
  });

function transcript(name, lines) {
  const p = join(dir, `${name}.jsonl`);
  writeFileSync(p, `${lines.join("\n")}\n`);
  return p;
}

test("stripMark and clockMark", () => {
  assert.equal(title.stripMark("[@09:05] oled-strip"), "oled-strip");
  assert.equal(title.stripMark("[C] oled-strip"), "oled-strip");
  assert.equal(title.stripMark("plain"), "plain");
  assert.equal(title.clockMark(new Date(2026, 0, 1, 9, 5).getTime()), "@09:05");
  assert.equal(title.stripMark("@09:05 oled-strip"), "oled-strip");
});

test("transcriptFacts: TTL from the latest request that wrote cache", () => {
  const one = title.transcriptFacts([assistant(T0, 500, 0), assistant(T0 + 1000, 0, 0)].join("\n"));
  assert.equal(one.ttlMs, 60 * 60 * 1000);
  assert.equal(one.lastAssistantMs, T0 + 1000);
  const five = title.transcriptFacts([assistant(T0, 500, 0), assistant(T0 + 1000, 0, 300)].join("\n"));
  assert.equal(five.ttlMs, 5 * 60 * 1000);
  assert.equal(title.transcriptFacts("").ttlMs, null);
});

test("UserPromptSubmit: mark = now + TTL - 5 min margin (exact under a 5 min TTL), Haiku name, folder fallback", () => {
  const t = transcript("a", [assistant(T0 - 60000, 100, 0)]);
  const raw = { hook_event_name: "UserPromptSubmit", session_id: "a", transcript_path: t, cwd: "/p/tmp" };
  assert.equal(title.titleForEvent(raw, T0), "@14:55 tmp");
  naming.writeNameState("a", { ...naming.readNameState("a"), name: "oled-strip" });
  assert.equal(title.titleForEvent(raw, T0), "@14:55 oled-strip");

  const t5 = transcript("a5", [assistant(T0 - 60000, 0, 100)]);
  assert.equal(title.titleForEvent({ ...raw, session_id: "a5", transcript_path: t5 }, T0), "@14:05 tmp");
});

test("SessionStart resume: [C] once inside the margin, else last reply + TTL - margin", () => {
  const t = transcript("b", [assistant(T0 - 2 * 3600 * 1000, 100, 0)]);
  const raw = { hook_event_name: "SessionStart", source: "resume", session_id: "b", transcript_path: t, cwd: "/p/x" };
  assert.equal(title.titleForEvent(raw, T0), "[C] x");
  const warm = transcript("b2", [assistant(T0 - 10 * 60000, 100, 0)]);
  assert.equal(title.titleForEvent({ ...raw, session_id: "b2", transcript_path: warm }, T0), "@14:45 x");
  const edge = transcript("b3", [assistant(T0 - 56 * 60000, 100, 0)]);
  assert.equal(title.titleForEvent({ ...raw, session_id: "b3", transcript_path: edge }, T0), "[C] x");
  assert.equal(title.titleForEvent({ ...raw, source: "startup" }, T0), null);
});

test("a /rename by the user keeps their name", () => {
  const ours = transcript("c", [assistant(T0, 100, 0), JSON.stringify({ type: "custom-title", customTitle: "@14:00 tmp" })]);
  const raw = { hook_event_name: "UserPromptSubmit", session_id: "c", transcript_path: ours, cwd: "/p/tmp" };
  naming.writeNameState("c", { ...naming.readNameState("c"), title: "@14:00 tmp" });
  assert.equal(title.titleForEvent(raw, T0), "@14:55 tmp");

  const renamed = transcript("c2", [assistant(T0, 100, 0), JSON.stringify({ type: "custom-title", customTitle: "my thing" })]);
  assert.equal(title.titleForEvent({ ...raw, transcript_path: renamed }, T0), "@14:55 my thing");
  // Our own title in the transcript next time: the manual name sticks.
  const after = transcript("c3", [assistant(T0, 100, 0), JSON.stringify({ type: "custom-title", customTitle: "@14:55 my thing" })]);
  naming.writeNameState("c", { ...naming.readNameState("c"), name: "haiku-name" });
  assert.equal(title.titleForEvent({ ...raw, transcript_path: after }, T0), "@14:55 my thing");
  // Our own mark in a transcript with no state (new or pruned): not a rename.
  assert.equal(title.titleForEvent({ ...raw, session_id: "c-new", transcript_path: after }, T0), "@14:55 tmp");
});
