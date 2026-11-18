import http from "node:http";

import { renderPage } from "./page.js";
import { ANIMATIONS, Referee } from "./referee.js";

const POLL_IDLE_MS = 2000;
const POLL_ALERT_MS = 400;
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
    getAnim: () => call("/anim", "GET"),
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

  async function stepOnce() {
    {
      try {
        referee.observe(await robot.getAnim());
        robotOk = true;
        lastError = null;
      } catch (err) {
        robotOk = false;
        lastError = err.message;
        referee.observe(null);
        return;
      }
      // Several writes can be due at once (alert done, then the owner's state).
      for (let i = 0; i < 3; i++) {
        const want = referee.next(now());
        if (want === null) break;
        try {
          referee.observe(await robot.setAnim(want));
          referee.sent(want, now());
          log(`-> ${want}`);
        } catch (err) {
          robotOk = false;
          lastError = err.message;
          break;
        }
        if (referee.playing) break;
      }
    }
  }

  function schedule() {
    if (stopped) return;
    const delay = referee.playing || referee.queue.length ? POLL_ALERT_MS : POLL_IDLE_MS;
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
        return send(res, 200, { ok: true, robot: robotOk, error: lastError });
      case "GET /anim":
        return send(res, 200, { ok: true, animation: referee.robotAnim ?? "none" });
      case "GET /state":
        return send(res, 200, { ok: true, robotOk, error: lastError, ...referee.snapshot(now()) });
      case "POST /anim": {
        const name = url.searchParams.get("name");
        if (!name) return send(res, 400, { ok: false, error: "missing name" });
        if (!ANIMATIONS.has(name)) return send(res, 400, { ok: false, error: "unknown animation" });
        const result = referee.request(
          { name, client: url.searchParams.get("client"), label: url.searchParams.get("label") },
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
