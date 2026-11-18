import http from "node:http";

import { renderPage } from "./page.js";
import { ANIMATIONS, Referee, STATUS_TTL_S } from "./referee.js";

const POLL_IDLE_MS = 2000;
const POLL_ALERT_MS = 400;
const POLL_OFFLINE_MS = 5000;
/** How often to read the robot's uptime to spot a quick reboot. */
const HEALTH_EVERY_MS = 10_000;
const ROBOT_TIMEOUT_MS = 3000;

/**
 * Robot HTTP client: GET/POST /anim with the Bearer token when set.
 * @param {{ url: string, token?: string | null, fetchImpl?: typeof fetch }} opts
 */
export function robotClient({ url, token, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, "");
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  /** @param {string} path @param {string} method */
  async function call(path, method) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(ROBOT_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`robot ${res.status}: ${body.error ?? "error"}`);
    return typeof body.animation === "string" ? body.animation : null;
  }

  return {
    /** @param {string} text @param {number} ttl */
    async setStatus(text, ttl) {
      const res = await fetchImpl(`${base}/status`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ text, ttl }),
        signal: AbortSignal.timeout(ROBOT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`robot ${res.status} on /status`);
    },
    getAnim: () => call("/anim", "GET"),
    /** @returns {Promise<number | null>} uptime_ms */
    async getUptime() {
      const res = await fetchImpl(`${base}/health`, {
        headers,
        signal: AbortSignal.timeout(ROBOT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`robot ${res.status} on /health`);
      const body = await res.json().catch(() => ({}));
      return typeof body.uptime_ms === "number" ? body.uptime_ms : null;
    },
    /** @param {string} name */
    setAnim: (name) => call(`/anim?name=${encodeURIComponent(name)}`, "POST"),
  };
}

/**
 * The broker: referee + one robot writer loop + HTTP API.
 * @param {{ robot: ReturnType<typeof robotClient>, referee?: Referee,
 *   now?: () => number, log?: (line: string) => void }} opts
 */
export function createBroker({ robot, referee = new Referee(), now = Date.now, log = () => {} }) {
  let robotOk = false;
  let lastError = null;
  /** When the robot went offline (or the broker started without it). */
  let offlineSince = now();
  let everOnline = false;
  let lastUptime = null;
  let lastHealthAt = 0;
  let busy = false;
  let again = false;
  let timer = null;
  let stopped = false;

  /** Run one poll + write step; never runs twice at once. */
  async function step() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await stepOnce();
      } while (again);
    } finally {
      busy = false;
    }
  }

  /** @param {Error} err */
  function markOffline(err) {
    if (robotOk) {
      offlineSince = now();
      referee.note(offlineSince, `robot offline: ${err.message}`);
      log(`robot offline: ${err.message}`);
    }
    robotOk = false;
    lastError = err.message;
    referee.observe(null);
  }

  // The robot may be off for hours (being worked on): requests keep being
  // refereed, nothing is sent, and the face is re-sent once it is back.
  async function stepOnce() {
    {
      let anim;
      try {
        anim = await robot.getAnim();
      } catch (err) {
        markOffline(err);
        return;
      }
      if (!robotOk) {
        robotOk = true;
        lastError = null;
        lastHealthAt = 0; // read the uptime now
        if (everOnline) referee.robotReset(now(), "back");
        log(everOnline ? "robot back" : "robot online");
        everOnline = true;
      }
      if (now() - lastHealthAt >= HEALTH_EVERY_MS) {
        lastHealthAt = now();
        try {
          const uptime = await robot.getUptime();
          if (uptime !== null && lastUptime !== null && uptime < lastUptime) {
            referee.robotReset(now(), "rebooted");
            log("robot rebooted");
          }
          lastUptime = uptime;
        } catch {
          // /health failing alone is not worth a state change.
        }
      }
      referee.observe(anim);
      // Several writes can be due at once (alert done, then the owner's state).
      for (let i = 0; i < 3; i++) {
        const want = referee.next(now());
        if (want === null) break;
        try {
          referee.observe(await robot.setAnim(want));
          referee.sent(want, now());
          log(`-> ${want}`);
        } catch (err) {
          markOffline(err);
          return;
        }
        if (referee.playing) break;
      }
      const text = referee.nextStatus(now());
      if (text !== null) {
        try {
          await robot.setStatus(text, STATUS_TTL_S);
          log(`status "${text}"`);
        } catch (err) {
          // Old firmware without /status: do not flag the robot offline.
          log(`status failed: ${err.message}`);
        }
        referee.statusSent(text, now());
      }
    }
  }

  function schedule() {
    if (stopped) return;
    const delay = !robotOk
      ? POLL_OFFLINE_MS
      : referee.playing || referee.queue.length
        ? POLL_ALERT_MS
        : POLL_IDLE_MS;
    timer = setTimeout(async () => {
      await step();
      schedule();
    }, delay);
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://broker");
    const route = `${req.method} ${url.pathname}`;

    if (req.method === "OPTIONS") return send(res, 200, { ok: true });

    switch (route) {
      case "GET /":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage());
        return;
      case "GET /health":
        // The broker is healthy whether or not the robot is.
        return send(res, 200, {
          ok: true,
          robot: robotOk,
          error: lastError,
          offlineSince: robotOk ? null : offlineSince,
        });
      case "GET /anim":
        return send(res, 200, { ok: true, animation: referee.robotAnim ?? "none" });
      case "GET /state":
        return send(res, 200, {
          ok: true,
          robotOk,
          error: lastError,
          offlineSince: robotOk ? null : offlineSince,
          ...referee.snapshot(now()),
        });
      case "POST /anim": {
        const name = url.searchParams.get("name");
        if (!name) return send(res, 400, { ok: false, error: "missing name" });
        if (!ANIMATIONS.has(name)) return send(res, 400, { ok: false, error: "unknown animation" });
        const result = referee.request(
          {
            name,
            client: url.searchParams.get("client"),
            label: url.searchParams.get("label"),
            detail: url.searchParams.get("detail"),
          },
          now(),
        );
        if (!result.ok) return send(res, 400, result);
        // Answer at once so a hook never waits on the robot.
        void step();
        const snap = referee.snapshot(now());
        return send(res, 200, {
          ok: true,
          animation: referee.robotAnim ?? "none",
          kind: result.kind,
          owner: snap.owner?.label ?? null,
        });
      }
      default:
        return send(res, 404, { ok: false, error: "not found" });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => send(res, 500, { ok: false, error: err.message }));
  });

  return {
    server,
    referee,
    step,
    /** @param {number} port @param {string} [host] */
    listen(port, host) {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          schedule();
          resolve(server.address());
        });
      });
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}
