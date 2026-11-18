import test from "node:test";
import assert from "node:assert/strict";
import { formatFileModifications } from "../src/integrations/claude-code/files.js";
import { animationForEvent } from "../src/integrations/claude-code/map.js";
import { createStyle } from "../src/util/style.js";

test("lifecycle events map to their poses", () => {
  assert.equal(animationForEvent({ hook_event_name: "SessionEnd" }), "sleep");
  assert.equal(
    animationForEvent({ hook_event_name: "SessionEnd", reason: "prompt_input_exit" }),
    "sleep"
  );
  for (const reason of ["clear", "resume"]) {
    assert.equal(
      animationForEvent({ hook_event_name: "SessionEnd", reason }),
      null,
      reason
    );
  }
  assert.equal(
    animationForEvent({ hook_event_name: "UserPromptSubmit" }),
    "reading"
  );
  assert.equal(
    animationForEvent({ hook_event_name: "SubagentStart" }),
    "thinking"
  );
  assert.equal(
    animationForEvent({ hook_event_name: "PostToolBatch" }),
    "thinking"
  );
  assert.equal(
    animationForEvent({ hook_event_name: "PostToolUseFailure" }),
    "error"
  );
  assert.equal(animationForEvent({ hook_event_name: "PreCompact" }), "thinking");
  assert.equal(
    animationForEvent({ hook_event_name: "PermissionRequest" }),
    "attention"
  );
  assert.equal(
    animationForEvent({ hook_event_name: "PermissionDenied" }),
    "abort"
  );
  assert.equal(
    animationForEvent({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
    }),
    "attention"
  );
  assert.equal(animationForEvent({ hook_event_name: "Stop" }), "ring");
  assert.equal(animationForEvent({ hook_event_name: "StopFailure" }), "error");
});

test("SessionStart welcomes only a fresh launch; every other start wakes up", () => {
  assert.equal(
    animationForEvent({ hook_event_name: "SessionStart", source: "startup" }),
    "welcome"
  );
  for (const source of ["resume", "clear", "compact", "fork", "other", undefined]) {
    assert.equal(
      animationForEvent({ hook_event_name: "SessionStart", source }),
      "wakeup",
      String(source)
    );
  }
});

test("PreToolUse maps reading tools to reading", () => {
  for (const tool of ["Read", "Grep", "Glob", "WebFetch", "WebSearch"]) {
    assert.equal(
      animationForEvent({ hook_event_name: "PreToolUse", tool_name: tool }),
      "reading",
      tool
    );
  }
});

test("PreToolUse maps typing tools to typing", () => {
  for (const tool of ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit"]) {
    assert.equal(
      animationForEvent({ hook_event_name: "PreToolUse", tool_name: tool }),
      "typing",
      tool
    );
  }
});

test("PreToolUse skips unknown or missing tools", () => {
  assert.equal(
    animationForEvent({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion" }),
    null
  );
  assert.equal(
    animationForEvent({ hook_event_name: "PreToolUse", tool_name: "mcp__x__y" }),
    null
  );
  assert.equal(animationForEvent({ hook_event_name: "PreToolUse" }), null);
});

test("skips missing, unknown, or Cursor-cased hook_event_name", () => {
  assert.equal(animationForEvent(undefined), null);
  assert.equal(animationForEvent(null), null);
  assert.equal(animationForEvent({}), null);
  assert.equal(animationForEvent({ hook_event_name: "" }), null);
  assert.equal(animationForEvent({ hook_event_name: "PostToolUse" }), null);
  assert.equal(animationForEvent({ hook_event_name: "stop" }), null);
  assert.equal(animationForEvent({ hook_event_name: "constructor" }), null);
});

test("describeFiles reports Write tool_input path", () => {
  const lines = formatFileModifications(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/proj/a.js" },
    },
    createStyle({ color: false }),
  );
  assert.deepEqual(lines, ["✎  touching: /proj/a.js"]);
});

test("requester is the session id, labelled with the project folder", async () => {
  const { claudeCode } = await import("../src/integrations/claude-code/index.js");
  const input = claudeCode.parseHook(
    [],
    JSON.stringify({ hook_event_name: "Stop", session_id: "abc-123", cwd: "/home/u/projects/tmp/" }),
  );
  assert.deepEqual(claudeCode.requester(input), { client: "abc-123", label: "tmp", detail: undefined });
  const bare = claudeCode.parseHook([], JSON.stringify({ hook_event_name: "Stop" }));
  assert.equal(claudeCode.requester(bare), null);
});

test("toolDetail: short what for the status strip, no shell arguments", async () => {
  const { toolDetail } = await import("../src/integrations/claude-code/index.js");
  const pre = (tool_name, tool_input) => ({ hook_event_name: "PreToolUse", tool_name, tool_input });
  assert.equal(toolDetail(pre("Edit", { file_path: "/a/b/oled.cpp" })), "Edit oled.cpp");
  assert.equal(toolDetail(pre("Read", { file_path: "C:\\x\\map.js" })), "Read map.js");
  assert.equal(toolDetail(pre("Bash", { command: "cd /repo && TOKEN=s3cret pio run -e x" })), "Bash pio run");
  assert.equal(toolDetail(pre("Bash", { command: "curl -H 'Authorization: Bearer x' http://h" })), "Bash curl");
  assert.equal(toolDetail(pre("Bash", { command: "/usr/bin/git push origin" })), "Bash git push");
  assert.equal(toolDetail(pre("Grep", { pattern: "handleAnim" })), "Grep handleAnim");
  assert.equal(toolDetail(pre("WebFetch", { url: "https://example.com/x" })), "Fetch example.com");
  assert.equal(toolDetail(pre("WebSearch", { query: "q" })), "Search");
  assert.equal(toolDetail({ hook_event_name: "Stop" }), undefined);
});

test("eventDetail: what each hook event says on the strip", async () => {
  const { eventDetail } = await import("../src/integrations/claude-code/index.js");
  const ev = (hook_event_name, extra = {}) => eventDetail({ hook_event_name, ...extra });
  assert.equal(ev("UserPromptSubmit"), "on it");
  assert.equal(ev("PermissionRequest", { tool_name: "Bash" }), "allow Bash?");
  assert.equal(ev("PostToolUseFailure", { tool_name: "mcp__web__crawl" }), "crawl failed");
  assert.equal(ev("PermissionDenied", { tool_name: "Edit" }), "Edit denied");
  assert.equal(ev("PreCompact"), "compacting");
  assert.equal(ev("SubagentStart", { agent_type: "Explore" }), "agent Explore");
  assert.equal(ev("Notification", { notification_type: "idle_prompt" }), "your turn");
  assert.equal(ev("Notification", { message: "Claude needs your permission to use Bash" }), "needs OK");
  assert.equal(ev("Stop"), undefined);
  assert.equal(ev("PreToolUse", { tool_name: "Read", tool_input: { file_path: "/a/b.md" } }), "Read b.md");
});

test("idle reminder is not 'needs you'; permission notifications are", () => {
  assert.equal(animationForEvent({ hook_event_name: "Notification", notification_type: "idle_prompt" }), null);
  assert.equal(
    animationForEvent({ hook_event_name: "Notification", message: "Claude is waiting for your input" }),
    null,
  );
  assert.equal(
    animationForEvent({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }),
    "attention",
  );
  assert.equal(animationForEvent({ hook_event_name: "PermissionRequest" }), "attention");
});
