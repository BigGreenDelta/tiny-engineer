/** "Who's asking" page: polls GET /state every 2 s. */
export function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tiny Engineer Broker</title>
<style>
  :root { --bg:#fbfaf7; --fg:#1f2328; --muted:#6a737d; --line:#e1e4e8; --card:#fff; --accent:#1f6feb; --warn:#d1242f; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d; --card:#161b22; --accent:#58a6ff; --warn:#ff7b72; }
  }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, sans-serif; }
  main { max-width:720px; margin:0 auto; padding:16px; }
  h1 { font-size:20px; margin:0 0 12px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:20px 0 6px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .face { font-size:28px; font-weight:600; }
  .muted { color:var(--muted); }
  table { width:100%; border-collapse:collapse; }
  td, th { text-align:left; padding:6px 4px; border-bottom:1px solid var(--line); }
  th { font-weight:500; color:var(--muted); font-size:13px; }
  .owner { color:var(--accent); font-weight:600; }
  .warn { color:var(--warn); font-weight:600; }
  ol { margin:0; padding-left:20px; }
  .log { font:12px/1.5 ui-monospace, monospace; max-height:260px; overflow:auto; }
</style>
</head>
<body>
<main>
  <h1>Tiny Engineer Broker</h1>
  <div class="card">
    <div class="muted" id="robot">robot: ...</div>
    <div class="face" id="face">-</div>
    <div id="strip" class="muted"></div>
    <div id="owner" class="muted"></div>
  </div>
  <h2>Clients</h2>
  <div class="card"><table><thead><tr><th>Who</th><th>State</th><th>Quiet</th></tr></thead><tbody id="clients"></tbody></table></div>
  <h2>Queue</h2>
  <div class="card"><ol id="queue"></ol><div id="queueEmpty" class="muted">empty</div></div>
  <h2>Log</h2>
  <div class="card log" id="log"></div>
</main>
<script>
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const time = (ms) => new Date(ms).toLocaleTimeString();
async function refresh() {
  let s;
  try { s = await (await fetch("state")).json(); } catch { document.getElementById("robot").textContent = "broker unreachable"; return; }
  document.getElementById("robot").textContent = s.robotOk ? "robot: online"
    : "robot: offline since " + time(s.offlineSince) + " (" + (s.error || "?") + "), requests still refereed";
  document.getElementById("face").textContent = s.robot || "-";
  document.getElementById("strip").textContent = s.status
    ? "strip: \u201c" + s.status + "\u201d (" + s.status.length + " chars" + (s.status.length > 21 ? ", scrolls" : "") + ")"
    : "strip: robot's own (... idle, Zzz sleep, else the animation name)";
  const underneath = s.owner ? "owner underneath: " + s.owner.label : "nobody else busy";
  document.getElementById("owner").textContent = s.playing
    ? "playing " + s.playing.name + " for " + s.playing.label + "; " + underneath
    : s.waiting.length
      ? "waiting for you: " + s.waiting.join(", ") + " (face shows attention); " + underneath
      : s.owner ? "owned by " + s.owner.label : "nobody owns the face";
  const ownerId = s.owner && s.owner.id;
  document.getElementById("clients").innerHTML = s.clients.map((c) =>
    "<tr><td class='" + (c.id === ownerId ? "owner" : "") + "'>" + esc(c.label) + "</td><td>" +
    (c.attention ? "<span class='warn'>needs you</span> " : "") + esc(c.state ? c.state + (c.detail ? " - " + c.detail : "") : "idle") + "</td><td>" + c.idleS + " s</td></tr>"
  ).join("") || "<tr><td colspan='3' class='muted'>none</td></tr>";
  document.getElementById("queue").innerHTML = s.queue.map((q) => "<li>" + esc(q.name) + " - " + esc(q.label) + "</li>").join("");
  document.getElementById("queueEmpty").style.display = s.queue.length ? "none" : "";
  document.getElementById("log").innerHTML = s.log.slice().reverse().map((l) => esc(time(l.at) + "  " + l.text)).join("<br>");
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
