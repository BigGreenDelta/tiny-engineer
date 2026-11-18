import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "te-naming-"));
process.env.TINY_ENGINEER_CONFIG_DIR = dir;

const fakeClaude = join(dir, "fake-claude.sh");
writeFileSync(fakeClaude, '#!/bin/sh\ncat > "$TE_FAKE_CLAUDE_IN"\necho "${TE_FAKE_CLAUDE_OUT:-oled-strip}"\n');
chmodSync(fakeClaude, 0o755);
process.env.TINY_ENGINEER_CLAUDE = fakeClaude;
process.env.TE_FAKE_CLAUDE_IN = join(dir, "claude-in.txt");

const naming = await import("../src/integrations/claude-code/naming.js");

test("parseNameReply keeps short slugs, keep, and rejects junk", () => {
  assert.equal(naming.parseNameReply("oled-strip\n"), "oled-strip");
  assert.equal(naming.parseNameReply('"Broker"'), "broker");
  assert.equal(naming.parseNameReply("wiki fix"), "wiki-fix");
  assert.equal(naming.parseNameReply("KEEP."), "keep");
  assert.equal(naming.parseNameReply("ESP32 VN pin wiring"), "esp32-vn");
  assert.equal(naming.parseNameReply("supercalifragilistic"), "supercalifra");
  assert.equal(naming.parseNameReply(""), null);
});

test("promptsFromTranscript: only what the user typed", () => {
  const t = join(dir, "t.jsonl");
  const lines = [
    { type: "user", message: { content: "add a status strip" } },
    { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
    { type: "user", isMeta: true, message: { content: "meta" } },
    { type: "user", message: { content: "<command-name>/clear</command-name>" } },
    { type: "user", message: { content: [{ type: "text", text: "make it borderless" }] } },
  ];
  writeFileSync(t, lines.map((l) => JSON.stringify(l)).join("\n"));
  assert.deepEqual(naming.promptsFromTranscript(t), ["add a status strip", "make it borderless"]);
});

test("runNameSession: first name at once, a rename needs two checks in a row", async () => {
  const run = async (out) => {
    process.env.TE_FAKE_CLAUDE_OUT = out;
    await naming.runNameSession("s1", JSON.stringify({ current: naming.sessionName("s1"), prompts: ["x"] }));
    return naming.sessionName("s1");
  };
  assert.equal(await run("oled-strip"), "oled-strip");
  assert.equal(await run("keep"), "oled-strip");
  assert.equal(await run("wiki-fix"), "oled-strip"); // one side trip
  assert.equal(await run("keep"), "oled-strip"); // back on topic: forgotten
  assert.equal(await run("deploy"), "oled-strip");
  assert.equal(await run("deploy-tool"), "deploy-tool"); // moved for real
});

test("notePrompt names on the 1st prompt and re-checks every 10th", async () => {
  process.env.TE_FAKE_CLAUDE_OUT = "broker";
  const raw = (prompt) => ({ hook_event_name: "UserPromptSubmit", session_id: "s2", prompt });
  naming.notePrompt(raw("one robot face for all sessions"));
  for (let i = 0; i < 50 && naming.sessionName("s2") === null; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(naming.sessionName("s2"), "broker");
  assert.equal(naming.readNameState("s2").prompts, 1);
  for (let i = 2; i <= 9; i++) naming.notePrompt(raw(`p${i}`));
  assert.equal(naming.readNameState("s2").namingSince, null); // nothing due
  process.env.TE_FAKE_CLAUDE_OUT = "deploy";
  naming.notePrompt(raw("p10"));
  assert.ok(naming.readNameState("s2").namingSince !== null);
  for (let i = 0; i < 50 && naming.readNameState("s2").pending !== "deploy"; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(naming.sessionName("s2"), "broker");
  assert.equal(naming.readNameState("s2").pending, "deploy");
});

test("namingPrompt asks to keep unless the topic moved", () => {
  const p = naming.namingPrompt("broker", ["a", "b"]);
  assert.match(p, /currently named "broker"/);
  assert.match(p, /keep/);
  assert.match(p, /\[2\] b/);
});
