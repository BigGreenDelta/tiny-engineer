import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeBrokerUrl } from "../src/api/broker";
import { StatusBar } from "../src/components/StatusBar";
import { StatusProvider } from "../src/status/status";
import { PauseCard } from "../src/views/PauseCard";

interface Seen {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

// Broker double: GET/POST /pause, POST /resume; `token` set means the POSTs need it.
function fakeBroker({ token }: { token?: string } = {}) {
  const broker = {
    seen: [] as Seen[],
    pause: null as { since: number; until: number | null } | null,
  };

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Partial<Record<string, string>>;
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
      const path = new URL(input).pathname;
      const reply = (status: number, json: unknown) =>
        Promise.resolve(new Response(JSON.stringify(json), { status }));

      broker.seen.push({ method, url: input, authorization: headers.Authorization ?? null, body });

      const view = () => ({
        ok: true,
        paused: broker.pause !== null,
        since: broker.pause?.since ?? null,
        until: broker.pause?.until ?? null,
      });

      if (method === "POST" && token && headers.Authorization !== `Bearer ${token}`) {
        return reply(401, { ok: false, error: "unauthorized" });
      }

      if (path === "/pause" && method === "GET") {
        return reply(200, view());
      }

      if (path === "/pause") {
        const forS = (body as { for_s?: number } | null)?.for_s;

        broker.pause = { since: Date.now(), until: forS ? Date.now() + forS * 1000 : null };

        return reply(200, view());
      }

      if (path === "/resume") {
        broker.pause = null;

        return reply(200, { ...view(), was_paused: true });
      }

      return reply(404, { ok: false, error: "not found" });
    }),
  );

  return broker;
}

function renderCard() {
  render(
    <StatusProvider>
      <StatusBar />
      <PauseCard />
    </StatusProvider>,
  );

  return userEvent.setup();
}

const stateText = () => document.getElementById("broker-pause-state")?.textContent ?? "";

describe("broker pause card", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks for the broker URL first and remembers it", async () => {
    const broker = fakeBroker();
    const user = renderCard();

    expect(stateText()).toMatch(/Set the Tiny Engineer Broker URL/);
    await user.type(screen.getByLabelText("Broker URL"), "http://broker:8790/{Enter}");

    await waitFor(() => expect(stateText()).toMatch(/^Live/));
    expect(localStorage.getItem("te_broker_url")).toBe("http://broker:8790");
    // The poll is a plain GET: no token, no preflight.
    expect(broker.seen[0]).toMatchObject({ method: "GET", authorization: null });
  });

  it("pauses for 30 minutes with the robot token, then resumes", async () => {
    localStorage.setItem("te_broker_url", "http://broker:8790");
    sessionStorage.setItem("te_access_token", "robot-token");
    const broker = fakeBroker({ token: "robot-token" });
    const user = renderCard();

    await user.click(await screen.findByRole("button", { name: "Pause 30 min" }));

    await waitFor(() => expect(stateText()).toMatch(/^Paused until \d/));
    const post = broker.seen.find((s) => s.method === "POST");

    expect(post).toMatchObject({ authorization: "Bearer robot-token", body: { for_s: 1800 } });

    await user.click(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() => expect(stateText()).toMatch(/^Live/));
    expect(broker.pause).toBeNull();
  });

  it("pauses until resume", async () => {
    localStorage.setItem("te_broker_url", "http://broker:8790");
    const broker = fakeBroker();
    const user = renderCard();

    await user.click(await screen.findByRole("button", { name: "Pause until resume" }));
    await waitFor(() => expect(stateText()).toBe("Paused until resume."));
    expect(broker.seen.find((s) => s.method === "POST")?.body).toEqual({});
  });

  it("says so when the broker refuses the token", async () => {
    localStorage.setItem("te_broker_url", "http://broker:8790");
    fakeBroker({ token: "other" });
    const user = renderCard();

    await user.click(await screen.findByRole("button", { name: "Pause 2 h" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/refused/);
    expect(stateText()).toMatch(/^Live/);
  });

  it("tells a robot URL from a broker", async () => {
    localStorage.setItem("te_broker_url", "http://robot");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response('{"ok":false}', { status: 404 }))),
    );
    renderCard();

    await waitFor(() => expect(stateText()).toMatch(/not a Tiny Engineer Broker/));
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
  });

  it("normalizes broker URLs", () => {
    expect(normalizeBrokerUrl(" https://b.example:8790/ ")).toBe("https://b.example:8790");
    expect(normalizeBrokerUrl("b.example")).toBe("");
    expect(normalizeBrokerUrl("javascript:alert(1)")).toBe("");
  });
});
