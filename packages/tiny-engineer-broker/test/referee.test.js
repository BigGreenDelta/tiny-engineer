import assert from "node:assert/strict";
import { test } from "node:test";

import { Referee } from "../src/referee.js";

/**
 * Drive a referee against a simulated robot. One-shots run `oneShotMs`
 * and fall back to none, like the firmware.
 */
function rig(opts = {}) {
  const ref = new Referee(opts);
  const robot = { anim: "none", until: 0 };
  let t = 0;
  const sent = [];
  function pump() {
    if (robot.until && t >= robot.until) {
      robot.anim = "none";
      robot.until = 0;
    }
    ref.observe(robot.anim);
    for (let i = 0; i < 3; i++) {
      const want = ref.next(t);
      if (want === null) return;
      robot.anim = want;
      const kind = ["attention", "ring", "error", "abort", "dead", "welcome", "wakeup"];
      robot.until = kind.includes(want) ? t + 3000 : 0;
      ref.observe(robot.anim);
      ref.sent(want, t);
      sent.push(want);
      if (ref.playing) return;
    }
  }
  return {
    ref,
    robot,
    sent,
    /** @param {string} client @param {string} name */
    post(client, name) {
      ref.request({ name, client, label: client }, t);
      pump();
    },
    /** advance the clock in 400 ms polls */
    wait(ms) {
      const end = t + ms;
      while (t < end) {
        t += 400;
        pump();
      }
    },
  };
}

test("first session owns the face; a second session's state waits", () => {
  const r = rig();
  r.post("A", "typing");
  r.post("B", "reading");
  assert.equal(r.robot.anim, "typing");
  assert.equal(r.ref.owner, "A");
  r.post("A", "thinking");
  assert.equal(r.robot.anim, "thinking");
});

test("owner finishing hands the face to the next live session", () => {
  const r = rig();
  r.post("A", "typing");
  r.post("B", "reading");
  r.post("A", "ring");
  assert.equal(r.robot.anim, "ring");
  r.wait(4000);
  assert.equal(r.ref.owner, "B");
  assert.equal(r.robot.anim, "reading");
});

test("attention from a non-owner plays at once, then the owner's state returns", () => {
  const r = rig({ attentionRepeatMs: 0 });
  r.post("A", "typing");
  r.post("B", "attention");
  assert.equal(r.robot.anim, "attention");
  r.wait(4000);
  assert.equal(r.robot.anim, "typing");
});

test("pending attention replays until that session moves on", () => {
  const r = rig({ attentionRepeatMs: 10_000 });
  r.post("A", "typing");
  r.post("B", "attention");
  r.wait(12_000);
  const replays = r.sent.filter((s) => s === "attention").length;
  assert.equal(replays, 2);
  r.post("B", "reading"); // you answered B
  r.wait(30_000);
  assert.equal(r.sent.filter((s) => s === "attention").length, 2);
  assert.equal(r.robot.anim, "typing");
});

test("attention gives up after attentionMaxMs", () => {
  const r = rig({ attentionRepeatMs: 5_000, attentionMaxMs: 20_000 });
  r.post("B", "attention");
  r.wait(60_000);
  const n = r.sent.filter((s) => s === "attention").length;
  assert.ok(n >= 3 && n <= 5, `played ${n} times`);
  assert.equal(r.ref.clients.get("B").attentionSince, null);
});

test("alerts queue, each plays once, back to back", () => {
  const r = rig();
  r.post("A", "typing");
  r.post("B", "error");
  r.post("C", "ring");
  r.post("C", "ring"); // duplicate while waiting
  r.wait(10_000);
  assert.deepEqual(r.sent, ["typing", "error", "ring", "typing"]);
});

test("greeting plays only when the face is free", () => {
  const r = rig();
  r.post("A", "welcome");
  assert.equal(r.robot.anim, "welcome");
  r.wait(4000);
  r.post("A", "typing");
  r.post("B", "welcome");
  assert.equal(r.robot.anim, "typing");
  assert.ok(!r.sent.slice(1).includes("welcome"));
});

test("state times out and the face goes back to none", () => {
  const r = rig({ stateTtlMs: 5_000 });
  r.post("A", "typing");
  r.wait(6_000);
  assert.equal(r.ref.owner, null);
  assert.equal(r.robot.anim, "none");
});

test("sleep only when the last busy session leaves", () => {
  const r = rig();
  r.post("A", "typing");
  r.post("B", "reading");
  r.post("A", "sleep");
  assert.equal(r.robot.anim, "reading");
  r.post("B", "sleep");
  assert.equal(r.robot.anim, "sleep");
  r.wait(5000);
  assert.equal(r.sent.filter((s) => s === "sleep").length, 1);
});

test("anonymous requests share one slot", () => {
  const r = rig();
  r.ref.request({ name: "typing" }, 0);
  assert.equal(r.ref.owner, "anon");
  assert.equal(r.ref.request({ name: "bogus" }, 0).ok, false);
});

test("an alert the robot never shows stops blocking the queue", () => {
  const ref = new Referee();
  ref.request({ name: "typing", client: "A" }, 0);
  ref.observe("none");
  assert.equal(ref.next(0), "typing");
  ref.observe("typing");
  ref.sent("typing", 0);
  ref.request({ name: "ring", client: "B" }, 100);
  assert.equal(ref.next(100), "ring");
  ref.observe("typing"); // robot still in its hold
  ref.sent("ring", 100);
  assert.equal(ref.next(1200), null); // never seen yet, wait
  assert.equal(ref.next(2700), "typing");
});

test("snapshot hands the face on even while the robot is offline", () => {
  const ref = new Referee();
  ref.request({ name: "typing", client: "A" }, 0);
  ref.request({ name: "reading", client: "B" }, 10);
  ref.request({ name: "ring", client: "A" }, 20);
  assert.equal(ref.snapshot(30).owner.id, "B");
});
