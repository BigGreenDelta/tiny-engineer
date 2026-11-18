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
