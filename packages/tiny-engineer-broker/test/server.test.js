import assert from "node:assert/strict";
import { test } from "node:test";

import { createBroker, robotClient } from "../src/server.js";

/** Fake robot fetch: records POSTs, answers like the firmware. */
function fakeRobot() {
  const robot = { anim: "none", posts: [], auth: [], status: [] };
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    robot.auth.push(init.headers.Authorization ?? null);
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

async function start() {
  const { robot, fetchImpl } = fakeRobot();
  const broker = createBroker({
    robot: robotClient({ url: "http://robot", token: "s3cret", fetchImpl }),
  });
  const addr = await broker.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${addr.port}`;
  return { robot, broker, base };
}

test("POST /anim takes the robot's query and adds client/label", async () => {
  const { robot, broker, base } = await start();
  try {
    let res = await fetch(`${base}/anim?name=typing&client=s1&label=tmp`, { method: "POST" });
    let body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.kind, "state");
    assert.equal(body.owner, "tmp");

    await fetch(`${base}/anim?name=reading&client=s2&label=other`, { method: "POST" });
    await broker.step();
    assert.deepEqual(robot.posts, ["typing"]);
    assert.equal(robot.status.at(-1), "tmp: typing +1");
    await fetch(`${base}/anim?name=typing&client=s1&label=tmp&detail=Edit%20oled.cpp`, { method: "POST" });
    await broker.step();
    assert.equal(robot.status.at(-1), "tmp: Edit oled.cpp +1");
    assert.ok(robot.auth.every((a) => a === "Bearer s3cret"));

    res = await fetch(`${base}/state`);
    body = await res.json();
    assert.equal(body.owner.label, "tmp");
    assert.equal(body.clients.length, 2);

    res = await fetch(`${base}/anim?name=nope`, { method: "POST" });
    assert.equal(res.status, 400);
    res = await fetch(`${base}/anim`, { method: "POST" });
    assert.equal(res.status, 400);

    res = await fetch(`${base}/`);
    assert.match(await res.text(), /Tiny Engineer Broker/);
  } finally {
    await broker.close();
  }
});

test("robot offline: requests still refereed, face re-sent when it is back", async () => {
  let t = 1_000_000;
  const robot = { anim: "none", posts: [], status: [], down: true, uptime: 5000 };
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    if (robot.down) throw new Error("connect EHOSTUNREACH");
    const u = new URL(url);
    if (u.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, uptime_ms: robot.uptime }), { status: 200 });
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
  const broker = createBroker({ robot: robotClient({ url: "http://robot", fetchImpl }), now: () => t });
  const addr = await broker.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    let res = await fetch(`${base}/anim?name=typing&client=s1&label=tmp`, { method: "POST" });
    assert.equal(res.status, 200);
    await fetch(`${base}/anim?name=ring&client=s2&label=bh1`, { method: "POST" });
    await broker.step();
    let health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.robot, false);
    assert.deepEqual(robot.posts, []);

    // Back after a long time: the stale ring is dropped, the state is sent.
    t += 60_000;
    robot.down = false;
    await broker.step();
    assert.deepEqual(robot.posts, ["typing"]);
    assert.equal(robot.status.at(-1), "tmp: typing");
    health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.robot, true);

    // Unplugged and back: the same face goes out again.
    robot.down = true;
    t += 2_000;
    await broker.step();
    robot.down = false;
    robot.anim = "none";
    t += 2_000;
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "typing"]);

    // A quick reboot between polls: uptime went down.
    robot.anim = "none";
    robot.uptime = 1000;
    t += 11_000;
    await broker.step();
    await broker.step();
    assert.deepEqual(robot.posts, ["typing", "typing", "typing"]);
  } finally {
    await broker.close();
  }
});
