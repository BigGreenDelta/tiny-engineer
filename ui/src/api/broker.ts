import { token } from "./client";

// The Tiny Engineer Broker (docs/broker.md) runs elsewhere; the panel only knows its URL from
// this browser's storage. Not a secret: the control calls send the robot's own access token.
const BROKER_URL_KEY = "te_broker_url";

export const brokerUrl = {
  get(): string {
    try {
      return localStorage.getItem(BROKER_URL_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set(value: string) {
    try {
      if (value) {
        localStorage.setItem(BROKER_URL_KEY, value);
      } else {
        localStorage.removeItem(BROKER_URL_KEY);
      }
    } catch {
      // Storage blocked: the URL lasts until the page reloads.
    }
  },
};

// "http://host:8790/" -> "http://host:8790"; anything that is not http(s) gives "".
export function normalizeBrokerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  return /^https?:\/\/[^\s/]+(\/\S*)?$/i.test(trimmed) ? trimmed : "";
}

export interface PauseState {
  paused: boolean;
  // Milliseconds since the epoch; `until` null means until resume.
  since: number | null;
  until: number | null;
}

export type BrokerResult =
  | { ok: true; state: PauseState }
  | { ok: false; reason: "unreachable" | "unauthorized" | "not-broker" | "error"; error: string };

interface BrokerReply {
  ok?: boolean;
  error?: string;
  paused?: boolean;
  since?: number | null;
  until?: number | null;
}

async function call(
  base: string,
  path: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<BrokerResult> {
  let res: Response;

  try {
    res = await fetch(base + path, init);
  } catch (err) {
    if (init.signal?.aborted) {
      throw err;
    }

    return { ok: false, reason: "unreachable", error: "Broker unreachable." };
  }

  let body: BrokerReply = {};

  try {
    body = (await res.json()) as BrokerReply;
  } catch {
    // Not JSON: the status code says enough.
  }

  if (res.status === 401) {
    return { ok: false, reason: "unauthorized", error: "Broker refused the robot's API token." };
  }

  if (res.status === 404) {
    return { ok: false, reason: "not-broker", error: "That URL is not a Tiny Engineer Broker." };
  }

  if (!res.ok || body.ok === false) {
    return { ok: false, reason: "error", error: body.error ?? `Broker error ${res.status}.` };
  }

  return {
    ok: true,
    state: { paused: Boolean(body.paused), since: body.since ?? null, until: body.until ?? null },
  };
}

// No headers on the poll: a simple GET needs no CORS preflight and carries no token.
export function getPause(base: string, signal?: AbortSignal) {
  return call(base, "/pause", { method: "GET", signal });
}

function control(base: string, path: string, json: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const stored = token.get();

  if (stored) {
    headers.Authorization = `Bearer ${stored}`;
  }

  return call(base, path, { method: "POST", headers, body: JSON.stringify(json) });
}

// `seconds` null pauses until resume.
export function pauseBroker(base: string, seconds: number | null) {
  return control(base, "/pause", seconds === null ? {} : { for_s: seconds });
}

export function resumeBroker(base: string) {
  return control(base, "/resume", {});
}
