import { useEffect, useState } from "preact/hooks";
import {
  type BrokerResult,
  brokerUrl,
  getPause,
  normalizeBrokerUrl,
  pauseBroker,
  type PauseState,
  resumeBroker,
} from "../api/broker";
import { Button } from "../components/Button";
import { useStatus } from "../status/status";

const POLL_MS = 5000;

const DURATIONS = [
  ["30 min", 1800],
  ["2 h", 7200],
  ["Until resume", null],
] as const;

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function describePause(state: PauseState) {
  if (!state.paused) {
    return "Live: agent activity animates the robot.";
  }

  return state.until === null ? "Paused until resume." : `Paused until ${clock(state.until)}.`;
}

// Pause switch of the Tiny Engineer Broker: while paused, agent sessions no longer animate the
// robot. The robot's own controls keep working.
export function PauseCard() {
  const { setStatus } = useStatus();
  const [url, setUrl] = useState(() => brokerUrl.get());
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(!url);
  const [state, setState] = useState<PauseState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Bumped after a pause or resume, so the poll restarts and shows the new state at once.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!url) {
      return undefined;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const result = await getPause(url, controller.signal);

        if (result.ok) {
          setState(result.state);
          setProblem(null);
        } else {
          setState(null);
          setProblem(result.error);
        }
      } catch {
        // Aborted: the card unmounted or the URL changed.
        return;
      }

      timer = setTimeout(() => void poll(), POLL_MS);
    }

    void poll();

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [url, generation]);

  function saveUrl() {
    const normalized = normalizeBrokerUrl(draft);

    if (draft.trim() && !normalized) {
      setStatus("Broker URL must start with http:// or https://.", "err");

      return;
    }

    brokerUrl.set(normalized);
    setUrl(normalized);
    setDraft(normalized);
    setState(null);
    setProblem(null);
    setEditing(!normalized);
  }

  async function send(request: Promise<BrokerResult>, done: string) {
    setSending(true);

    try {
      const result = await request;

      if (result.ok) {
        setState(result.state);
        setProblem(null);
        setStatus(done, "ok");
      } else {
        setStatus(result.error, "err");
      }
    } finally {
      setSending(false);
      setGeneration((n) => n + 1);
    }
  }

  return (
    <div id="broker-pause" className="info-strip pause-card">
      <div className="pause-head">
        <strong>Agent activity</strong>
        <span id="broker-pause-state" className={state?.paused ? "pause-on" : undefined}>
          {!url
            ? "Set the Tiny Engineer Broker URL to pause it."
            : state
              ? describePause(state)
              : (problem ?? "Checking broker…")}
        </span>
      </div>
      {url && state && (
        <div className="pause-actions">
          {state.paused ? (
            <Button
              variant="primary"
              className="pause-btn"
              disabled={sending}
              onClick={() => void send(resumeBroker(url), "Resumed.")}
            >
              Resume
            </Button>
          ) : (
            DURATIONS.map(([label, seconds]) => (
              <Button
                key={label}
                variant="secondary"
                className="pause-btn"
                disabled={sending}
                onClick={() => void send(pauseBroker(url, seconds), "Paused.")}
              >
                {seconds === null ? "Pause until resume" : `Pause ${label}`}
              </Button>
            ))
          )}
        </div>
      )}
      {editing ? (
        <form
          className="pause-url"
          onSubmit={(event) => {
            event.preventDefault();
            saveUrl();
          }}
        >
          <input
            type="url"
            aria-label="Broker URL"
            placeholder="https://broker.example:8790"
            value={draft}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <Button type="submit" variant="secondary" className="pause-btn pause-save">
            Save
          </Button>
        </form>
      ) : (
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>
          Broker: {url}
        </button>
      )}
    </div>
  );
}
