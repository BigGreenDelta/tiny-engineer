# Tiny Engineer Broker

The Tiny Engineer Broker is a small service that sits between every agent session and the robot. Sessions file requests with the broker; the broker decides what the face shows and is the only client that writes to the robot. Without it the robot keeps one slot and the last `POST /anim` wins, so two Claude Code sessions fight over the face.

The robot firmware is unchanged. The broker speaks the robot's own HTTP API, and its own `POST /anim` takes the same query, so a hook only needs its `TINY_ENGINEER_URL` pointed at the broker.

## Requests

```bash
curl -X POST "http://broker:8790/anim?name=typing&client=<session id>&label=tmp"
```

| Param | Meaning |
| --- | --- |
| `name` | Animation name, same allow-list as the robot (`none`, `typing`, `reading`, `thinking`, `talking`, `ring`, `welcome`, `attention`, `error`, `abort`, `dead`, `wakeup`, `sleep`) |
| `client` | Who is asking, 1-64 chars. Claude Code hooks send the `session_id` from the hook stdin. Missing: the request counts as client `anon` |
| `label` | Short display name, 1-20 chars. Missing: the first 8 chars of `client`. Two clients with the same label are shown as `tmp`, `tmp2`, ... |
| `detail` | What the client is doing, 1-40 chars, for the status strip (see below). Optional |

The broker remembers one slot per client. A request only changes the slot of the client that sent it.

## What each animation means to the broker

| Kind | Animations | Effect |
| --- | --- | --- |
| state | `typing`, `reading`, `thinking`, `talking` | Sets the client's state and strip detail. Lives until the client posts something else, or until `state_ttl_s` passes with no request from that client; the detail ends with it |
| attention | `attention` | Marks the client as waiting for you. The face shows `attention` at once, over the owner's state, until that client posts anything else (you answered) or `attention_max_s` passes. The firmware's attention is a call plus up to 60 s of waiting; once the robot falls back to `none`, the broker shows it again after `attention_repeat_s` |
| alert | `ring`, `error`, `abort`, `dead` | Plays once, even when another client owns the face. `ring` (turn finished) also clears the client's state |
| greeting | `welcome`, `wakeup` | Registers the client and ends its state (a session start, resume or finished compaction means it is back at its prompt; the turn timer keeps running). Plays only when nobody owns the face and no alert is waiting; otherwise skipped |
| idle | `none` | Clears the client's state |
| leave | `sleep` | Removes the client. The robot is sent `sleep` only when no other client has a live state or a pending attention |

## Session names

Session names come from [cc-namer](https://github.com/BigGreenDelta/cc-namer), a separate Claude Code hook that names each session with the local `claude` CLI (Haiku) and keeps the name current. The Tiny Engineer hook only reads the name from cc-namer's state file (`~/.local/state/cc-namer/sessions/<session id>.json`, field `name`) and sends it as `label`; prompts never reach the broker.

- Without cc-namer, or until a name exists, the label is the project folder.

## Status strip

On a 64-row panel the robot shows a line of text above the face. The broker writes it with the robot's `POST /status` whenever it changes (and again every 4 min, as the robot clears it after 5 min), cut to 48 characters (the robot scrolls anything over 21):

| Face | Strip |
| --- | --- |
| owner's state | `<label>: <detail>`, e.g. `tmp: Edit oled.cpp`; without a detail the state, and thinking picks one of `thinking`, `hmm...`, `pondering`, `mulling it over`, `connecting dots` |
| other sessions busy too | ` +N` at the end, e.g. `tmp: Edit oled.cpp +1` |
| one session waits for you | `<label>: <detail>` (`tmp: allow Bash?`) or `<label> NEEDS YOU` |
| several wait | `2 NEED YOU` |
| `ring` | `<label>: done 3m12s`: time since the turn started (first state after idle) |
| `error` / `abort` | `<label>: <detail>` (`tmp: Bash failed`, `tmp: Edit denied`), else `error` / `stopped` |
| `welcome` / `wakeup` | `<label>: hello` |
| idle, sleep | cleared: the robot animates `...` / `Zzz` itself |

`detail` is a `POST /anim` param (1-40 printable chars). The Claude Code hook sends:

| Hook event | detail |
| --- | --- |
| `PreToolUse` | tool + file (`Edit oled.cpp`), shell program and subcommand only (`Bash pio run`, never arguments, which can hold secrets), search pattern, or fetched host |
| `UserPromptSubmit` | `on it` |
| `SubagentStart` | `agent <type>` or `subagent` |
| `PreCompact` | `compacting` |
| `PermissionRequest` | `allow <tool>?` |
| `PermissionDenied` | `<tool> denied` |
| `PostToolUseFailure` | `<tool> failed` |
| `Notification` | `needs OK` (permission). The idle reminder ("waiting for your input", about 60 s after a turn) posts nothing: `Stop` already rang, and waiting means blocked until you act |
| `StopFailure` | `turn failed` |

## Who owns the face

1. Alerts go into one queue, oldest first. A request that is already waiting for the same client and animation is not queued twice. The queue holds at most 32 entries.
2. While the queue has entries, the broker plays them one by one, back to back. An entry is done once the robot was seen playing it and then reports a different animation (at least 1 s, at most 15 s after it was sent). An entry the robot never shows (for example `wakeup` while awake) stops blocking after 2.5 s.
3. Otherwise, while any client waits for you, the face shows `attention`.
4. Otherwise the owner's state is shown. The owner is the client whose state is on the face. With no owner, the first client to post a state becomes the owner.
5. States never take the face from another client. The owner keeps it until its state ends: `ring`, `none`, `sleep`, or `state_ttl_s` without a request.
6. When the owner lets go, the client with the most recent live state becomes the owner. With nobody left, the robot is sent `none`.

The broker sends the robot a request only when what the face should show changes, plus a refresh of the owner's state at most every 30 s while the owner keeps posting it (this restarts the robot's `continuous_timeout`). All robot writes go out one at a time.

The robot's own reflexes stay: the push-button Actions, the sleep timer, `continuous_timeout` and the boot welcome. The broker does not fight them. It polls `GET /anim` (every 2 s, every 0.4 s while an alert plays) to know what the face shows.

## Robot offline

The broker does not depend on the robot being up; it may be off or rebooting for hours while it is worked on.

- Requests are still taken (**200**) and refereed: slots, owner, attentions and TTLs keep running. Nothing is sent.
- Polls slow to every 5 s while the robot does not answer. `GET /health` stays `ok: true`, with `robot: false` and `offlineSince`.
- Alerts that waited more than 30 s are dropped instead of playing late.
- When the robot answers again, or its `uptime_ms` (read every 10 s) went down because it rebooted between polls, the broker forgets what it sent and sends the current face and strip text again.

## Pause

A pause switch for when you test or work on the robot: agent sessions keep posting, the robot stays still.

```bash
tiny-engineer pause            # until resume
tiny-engineer pause --for 30m  # resumes by itself after 30 minutes
tiny-engineer status           # paused or not, and until when
tiny-engineer resume
```

- On pause the broker takes down only what it put up: `none` if it showed a state or attention, and an empty strip if it wrote one. A robot the broker left alone gets no write at all, so servos you drive by hand do not move.
- While paused the broker sends the robot nothing. It still polls `GET /anim` (every 5 s) and keeps refereeing: requests get **200** with `"paused": true`, slots, owner and TTLs keep running, the page shows a banner. Alerts filed while paused (`ring`, `error`, ...) are dropped, never played late.
- On resume, by hand or when a `--for` pause runs out (seen within 5 s), the broker shows the current face again: the owner's state if one is live, otherwise nothing.
- The robot's own API stays as it is: `POST /test/servo`, `POST /setup/servo`, the web panel, the button and the sleep timer all work while paused. Only the broker holds back.
- With `TE_PAUSE_FILE` (set in the image to `/data/pause.json`; the Quadlet and `compose.yaml` mount a volume there) the switch survives a broker restart, a redeploy and a host reboot. A timed pause that ran out while the broker was down is over.
- The pause is the broker's, not the robot's: a hook that posts to the robot directly is not paused. The firmware has no pause of its own (it would need a reflash); the broker is the only writer, so pausing it covers every session.

`POST /pause` and `POST /resume` need `Authorization: Bearer <TE_BROKER_TOKEN>` when that variable is set; without it they are open, like `POST /anim`. Hooks never need the token. The CLI sends `TINY_ENGINEER_TOKEN`, or reads the token from stdin with `--token-stdin`:

```bash
op read "op://<vault>/<item>/credential" | tiny-engineer pause --for 1h --token-stdin
```

## Broker API

| Route | Reply |
| --- | --- |
| `POST /anim?name=&client=&label=` | `{"ok":true,"animation":"<robot now>","kind":"state","owner":"<label>"}`, plus `"paused":true` while paused. Unknown `name` gives **400** `unknown animation` |
| `GET /anim` | `{"ok":true,"animation":"<robot now>"}`, the robot's reply shape |
| `GET /state` | Robot view, pause, owner, every client slot, the queue and the last 200 log lines (each request with its text, each face and strip text sent) |
| `GET /health` | `{"ok":true,"robot":true,"pause":null}`; `robot` is false when the last poll failed, then `offlineSince` says since when; `pause` is `{"since":<ms>,"until":<ms or null>}` while paused |
| `GET /pause` | `{"ok":true,"paused":false,"since":null,"until":null}`; times in ms since the epoch, `until` null means until resume |
| `POST /pause` | Optional JSON body `{"for_s":1800}` (1 to 604800); without it, until resume. Pausing again while paused moves the end. Reply as `GET /pause`. **401** without the token when `TE_BROKER_TOKEN` is set, **400** for a bad body |
| `POST /resume` | Reply as `GET /pause` plus `"was_paused"`. **401** as above |
| `GET /` | "Who's asking" page: owner, clients, queue and log, refreshed every 2 s |

## Settings

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TE_ROBOT_URL` | `http://tiny-engineer.local` | Robot base URL |
| `TE_ROBOT_TOKEN` | empty | Robot `access_token`, sent as `Authorization: Bearer` |
| `TE_BROKER_PORT` | `8790` | Listen port |
| `TE_STATE_TTL_S` | `300` | A state with no new request for this long ends |
| `TE_ATTENTION_REPEAT_S` | `30` | After the robot's own attention wait ends, show it again this long after the last send; `0` shows it once |
| `TE_ATTENTION_MAX_S` | `900` | A pending attention is dropped after this long |
| `TE_BROKER_TOKEN` | empty | Bearer token for `POST /pause` and `POST /resume`; empty leaves them open |
| `TE_PAUSE_FILE` | empty (`/data/pause.json` in the image) | Where the pause switch is kept; empty keeps it in memory only |

## Only writer

Set an `access_token` on the robot (`POST /settings {"access_token":"..."}`) and give it to the broker only. Every other caller of the robot's JSON API then gets **401**. The robot's web panel asks for the token once.

## Hooks

`tiny-engineer hook claude-code` sends `client` (the hook's `session_id`) and `label` (the last folder of the hook's `cwd`) with every `POST /anim`. The robot ignores both, so the same hook works with or without the broker. Point it at the broker:

```bash
TINY_ENGINEER_URL=http://<broker host>:8790
```

## Running it

```bash
cd packages/tiny-engineer-broker
TE_ROBOT_URL=http://tiny-engineer.local node bin/tiny-engineer-broker.js
```

Windows host with rootful podman in WSL: `scripts/deploy-broker.sh` copies this package over WinRM, builds `localhost/tiny-engineer-broker`, installs the Quadlet from `deploy/tiny-engineer-broker.container`, writes `TE_ROBOT_URL` / `TE_ROBOT_TOKEN` into `/etc/tiny-engineer-broker.env` (mode 600), restarts it, and forwards port 8790 to the WSL address (`netsh portproxy` plus a LocalSubnet firewall rule). Host, credentials (values or `op://` references) and robot settings go in the git-ignored `scripts/deploy-broker.local.env`; the script header lists them. Run it again after a host reboot: the WSL address changes and the port forward has to follow. From Node use an IP or a name with an IPv4 record: a bare Windows host name can resolve to an IPv6 link-local address the IPv4 port forward does not answer.

Elsewhere: `compose.yaml` with `TE_ROBOT_URL` and `TE_ROBOT_TOKEN` in a `.env`, `docker compose up -d --build`.
