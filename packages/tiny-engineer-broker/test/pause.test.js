import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Pause, PAUSE_MAX_S, pauseSeconds } from "../src/pause.js";
import { createBroker, robotClient } from "../src/server.js";

/** Fake robot: records every write; `down` makes it unreachable. */
function fakeRobot() {
  const robot = { anim: "none", posts: [], status: [], down: false };
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    if (robot.down) throw new Error("connect EHOSTUNREACH");
    const u = new URL(url);
    if (u.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, uptime_ms: 5000 }), { status: 200 });
    }
    if (init.method === "POST" && u.pathname === "/status") {
      robot.status.push(JSON.parse(init.body).text);
      return new Response('{"ok":true}', { status: 200 });
    }
    if (init.method === "POST") {
      robot.anim = u.searchParams.get("name");
      robot.posts.push(robot.anim);
    }
    return new Response(JSON.stringify({ ok: true, animation: robot.anim }), { status: 200 });
  };
  return { robot, fetchImpl };
}

/** @param {{ controlToken?: string | null, pause?: Pause }} [opts] */
async function start(opts = {}) {
  const clock = { t: 1_000_000 };
  const { robot, fetchImpl } = fakeRobot();
  const broker = createBroker({
    robot: robotClient({ url: "http://robot", fetchImpl }),
    now: () => clock.t,
    controlToken: opts.controlToken ?? null,
    pause: opts.pause,
  });
  const addr = await broker.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${addr.port}`;
  /** @param {string} path @param {{ body?: unknown, token?: string }} [o] */
  const post = async (path, o = {}) => {
    const headers = {};
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    return { status: res.status, body: await res.json() };
  };
  // Start-up clears the strip once (listen runs the first step in the
  // background); tests count writes after that.
  for (let i = 0; i < 100 && robot.status.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  robot.status.length = 0;
  return { robot, broker, base, clock, post };
}

test("pauseSeconds: absent means until resume, else 1 s to a week", () => {
  assert.deepEqual(pauseSeconds(null), { ok: true, seconds: null });
  assert.deepEqual(pauseSeconds({}), { ok: true, seconds: null });
  assert.deepEqual(pauseSeconds({ for_s: 1800 }), { ok: true, seconds: 1800 });
  assert.deepEqual(pauseSeconds({ for_s: PAUSE_MAX_S }), { ok: true, seconds: PAUSE_MAX_S });
  for (const bad of [0, -5, 1.5, "60", PAUSE_MAX_S + 1]) {
    assert.equal(pauseSeconds({ for_s: bad }).ok, false, String(bad));
  }
  assert.equal(pauseSeconds([1]).ok, false);
  assert.equal(pauseSeconds("x").ok, false);
});

test("Pause: a file keeps the switch across a restart; resume removes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "te-pause-"));
  try {
    const file = join(dir, "state", "pause.json");
    const a = new Pause({ file });
    a.start(1000, 60);
    const b = new Pause({ file });
    assert.deepEqual(b.view(2000), { since: 1000, until: 61_000 });
    assert.equal(b.active(61_000), false);
    // Moving the end of a running pause keeps its start.
    b.start(5000, null);
    assert.deepEqual(new Pause({ file }).view(10_000_000), { since: 1000, until: null });
    assert.equal(b.stop(), true);
    assert.equal(new Pause({ file }).active(5000), false);
    assert.equal(b.stop(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pause takes down the broker's face, holds every write, resume shows the current face", async () => {
  const { robot, broker, base, post } = await start();
  try {
    await post("/anim?name=typing&client=s1&label=tmp&detail=Edit%20a.c");
    await broker.step();
    assert.deepEqual(robot.posts, ["typing"]);
    assert.equal(robot.status.at(-1), "tmp: Edit a.c");

    let res = await post("/pause");
    assert.equal(res.status, 200);
    assert.equal(res.body.paused, true);
    assert.equal(res.body.until, null);
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "none"]);
    assert.equal(robot.status.at(-1), "");

    // Requests are taken and refereed, nothing reaches the robot.
    res = await post("/anim?name=reading&client=s1&label=tmp&detail=Read%20b.c");
    assert.equal(res.status, 200);
    assert.equal(res.body.paused, true);
    await post("/anim?name=ring&client=s2&label=bh1");
    await post("/anim?name=attention&client=s3&label=ui");
    await post("/anim?name=none&client=s3&label=ui");
    await broker.step();
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "none"]);
    const state = await (await fetch(`${base}/state`)).json();
    assert.equal(state.pause.until, null);
    assert.deepEqual(state.queue, []);
    assert.equal(state.owner.label, "tmp");
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(typeof health.pause.since, "number");

    // A second pause while paused writes nothing again.
    await post("/pause");
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "none"]);

    res = await post("/resume");
    assert.equal(res.body.paused, false);
    assert.equal(res.body.was_paused, true);
    await broker.step();
    // The ring filed while paused does not play late; the current state does.
    assert.deepEqual(robot.posts, ["typing", "none", "reading"]);
    assert.equal(robot.status.at(-1), "tmp: Read b.c");
    assert.equal((await post("/resume")).body.was_paused, false);
  } finally {
    await broker.close();
  }
});

test("pause with nothing up from the broker sends the robot nothing", async () => {
  const { robot, broker, post } = await start();
  try {
    robot.anim = "typing"; // someone else drives the robot by hand
    await post("/pause");
    await broker.step();
    await post("/resume");
    await broker.step();
    assert.deepEqual(robot.posts, []);
    assert.deepEqual(robot.status, []);
  } finally {
    await broker.close();
  }
});

test("a timed pause runs out on the broker clock", async () => {
  const { robot, broker, base, clock, post } = await start();
  try {
    let res = await post("/pause", { body: { for_s: 60 } });
    assert.equal(res.body.until, clock.t + 60_000);
    assert.equal((await post("/pause", { body: { for_s: 0 } })).status, 400);
    const bad = await fetch(`${base}/pause`, { method: "POST", body: "{nope" });
    assert.equal(bad.status, 400);

    await post("/anim?name=thinking&client=s1&label=tmp");
    await broker.step();
    assert.deepEqual(robot.posts, []);
    clock.t += 59_000;
    await broker.step();
    assert.deepEqual(robot.posts, []);
    clock.t += 1_000;
    await broker.step();
    assert.deepEqual(robot.posts, ["thinking"]);
    res = await fetch(`${base}/pause`);
    assert.deepEqual(await res.json(), { ok: true, paused: false, since: null, until: null });
  } finally {
    await broker.close();
  }
});

test("pause during a network blip: the face still up is taken down when the robot is back", async () => {
  const { robot, broker, post } = await start();
  try {
    await post("/anim?name=typing&client=s1&label=tmp");
    await broker.step();
    assert.deepEqual(robot.posts, ["typing"]);
    assert.equal(robot.status.at(-1), "tmp: typing");
    robot.down = true;
    await broker.step();
    await post("/pause");
    await broker.step();
    robot.down = false; // back, still showing the broker's face
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "none"]);
    assert.equal(robot.status.at(-1), "");
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "none"]);
  } finally {
    await broker.close();
  }
});

test("pause while the robot is offline: a rebooted robot gets nothing when it is back", async () => {
  const { robot, broker, post } = await start();
  try {
    await post("/anim?name=typing&client=s1&label=tmp");
    await broker.step();
    assert.deepEqual(robot.posts, ["typing"]);
    robot.down = true;
    await broker.step();
    await post("/pause");
    await broker.step();
    robot.down = false;
    robot.anim = "none";
    await broker.step();
    await broker.step();
    assert.deepEqual(robot.posts, ["typing"]);
    await post("/resume");
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "typing"]);
  } finally {
    await broker.close();
  }
});

test("TE_BROKER_TOKEN guards POST /pause and /resume, GET stays open", async () => {
  const { broker, base, post } = await start({ controlToken: "s3cret" });
  try {
    assert.equal((await post("/pause")).status, 401);
    assert.equal((await post("/pause", { token: "wrong" })).status, 401);
    assert.equal((await post("/pause", { token: "s3cret" })).status, 200);
    assert.equal((await fetch(`${base}/pause`)).status, 200);
    assert.equal((await post("/resume")).status, 401);
    assert.equal((await post("/resume", { token: "s3cret" })).status, 200);
    // Hooks need no token.
    assert.equal((await post("/anim?name=typing&client=s1")).status, 200);
  } finally {
    await broker.close();
  }
});
