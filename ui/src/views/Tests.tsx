import { useState } from "preact/hooks";
import { Button } from "../components/Button";
import { useStatus } from "../status/status";

const TESTS = [
  ["/test/audio", "Play ascending tones through the speaker.", "Audio tones"],
  ["/test/audio/bell", "Play the bell WAV file from storage.", "Bell sound"],
  ["/test/screen", "Draw a demo pattern on the OLED screen.", "OLED screen"],
  ["/test/movement", "Exercise all five servos through a sweep.", "All servos"],
  ["/test/led", "Cycle the onboard RGB LED through colors.", "RGB LED"],
] as const;

/** "#rrggbb" from the colour picker as 0-255 channels. */
function channels(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);

  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function Tests() {
  const { perform } = useStatus();
  const [color, setColor] = useState("#ff8000");
  const [title, setTitle] = useState("HELLO");
  const [text, setText] = useState("from the PC");

  async function run(path: string) {
    await perform({ path, pending: "Running…", failure: "Request failed", done: "Done." });
  }

  async function post(path: string, json: object, done: string) {
    await perform({
      path,
      request: { method: "POST", json },
      pending: "Sending…",
      failure: "Request failed",
      done,
    });
  }

  return (
    <section>
      <h2 className="page-title">Hardware tests</h2>
      <p className="page-desc">Run built-in diagnostics. Each test blocks until complete.</p>
      {TESTS.map(([path, text, label]) => (
        <div key={path} className="test-card">
          <p>{text}</p>
          <Button onClick={() => run(path)}>{label}</Button>
        </div>
      ))}

      <h3 className="page-title">Debug</h3>
      <div className="test-card">
        <p>Hold the RGB LED on any colour until released.</p>
        <div className="form-group">
          <label htmlFor="debug-rgb">Colour</label>
          <input
            id="debug-rgb"
            type="color"
            value={color}
            onInput={(event) => setColor(event.currentTarget.value)}
          />
        </div>
        <Button onClick={() => post("/test/rgb", channels(color), "LED held.")}>Hold colour</Button>
        <Button onClick={() => post("/test/rgb", { release: true }, "LED released.")}>
          Release
        </Button>
      </div>
      <div className="test-card">
        <p>Show a title and one line of text on the OLED for 3 seconds.</p>
        <div className="form-group">
          <label htmlFor="debug-oled-title">Title</label>
          <input
            id="debug-oled-title"
            type="text"
            maxLength={21}
            value={title}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="debug-oled-text">Text</label>
          <input
            id="debug-oled-text"
            type="text"
            maxLength={21}
            value={text}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        </div>
        <Button
          disabled={title.length === 0}
          onClick={() =>
            post("/test/oled", text.length > 0 ? { title, text } : { title }, "Text shown.")
          }
        >
          Show text
        </Button>
      </div>
    </section>
  );
}
