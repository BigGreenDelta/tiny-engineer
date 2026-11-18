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
| `label` | Short display name, 1-20 chars, e.g. the project folder. Missing: the first 8 chars of `client` |

The broker remembers one slot per client. A request only changes the slot of the client that sent it.

## What each animation means to the broker

| Kind | Animations | Effect |
| --- | --- | --- |
| state | `typing`, `reading`, `thinking`, `talking` | Sets the client's state. Lives until the client posts something else, or until `state_ttl_s` passes with no request from that client |
| attention | `attention` | Marks the client as waiting for you. The face shows `attention` at once, over the owner's state, until that client posts anything else (you answered) or `attention_max_s` passes. The firmware's attention is a call plus up to 60 s of waiting; once the robot falls back to `none`, the broker shows it again after `attention_repeat_s` |
| alert | `ring`, `error`, `abort`, `dead` | Plays once, even when another client owns the face. `ring` (turn finished) also clears the client's state |
| greeting | `welcome`, `wakeup` | Registers the client. Plays only when nobody owns the face and no alert is waiting; otherwise skipped |
| idle | `none` | Clears the client's state |
| leave | `sleep` | Removes the client. The robot is sent `sleep` only when no other client has a live state or a pending attention |

## Who owns the face

1. Alerts go into one queue, oldest first. A request that is already waiting for the same client and animation is not queued twice. The queue holds at most 32 entries.
2. While the queue has entries, the broker plays them one by one, back to back. An entry is done once the robot was seen playing it and then reports a different animation (at least 1 s, at most 15 s after it was sent). An entry the robot never shows (for example `wakeup` while awake) stops blocking after 2.5 s.
3. Otherwise, while any client waits for you, the face shows `attention`.
4. Otherwise the owner's state is shown. The owner is the client whose state is on the face. With no owner, the first client to post a state becomes the owner.
5. States never take the face from another client. The owner keeps it until its state ends: `ring`, `none`, `sleep`, or `state_ttl_s` without a request.
6. When the owner lets go, the client with the most recent live state becomes the owner. With nobody left, the robot is sent `none`.

The broker sends the robot a request only when what the face should show changes, plus a refresh of the owner's state at most every 30 s while the owner keeps posting it (this restarts the robot's `continuous_timeout`). All robot writes go out one at a time.

The robot's own reflexes stay: the push-button Actions, the sleep timer, `continuous_timeout` and the boot welcome. The broker does not fight them. It polls `GET /anim` (every 2 s, every 0.4 s while an alert plays) to know what the face shows.

## Broker API

| Route | Reply |
| --- | --- |
| `POST /anim?name=&client=&label=` | `{"ok":true,"animation":"<robot now>","kind":"state","owner":"<label>"}`. Unknown `name` gives **400** `unknown animation` |
| `GET /anim` | `{"ok":true,"animation":"<robot now>"}`, the robot's reply shape |
| `GET /state` | Robot view, owner, every client slot, the queue and the last 50 log lines |
| `GET /health` | `{"ok":true,"robot":true}`; `robot` is false when the last poll failed |
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

## Only writer

Set an `access_token` on the robot (`POST /settings {"access_token":"..."}`) and give it to the broker only. Every other caller of the robot's JSON API then gets **401**. The robot's web panel asks for the token once.

## Hooks

`tiny-engineer hook claude-code` sends `client` (the hook's `session_id`) and `label` (the last folder of the hook's `cwd`) with every `POST /anim`. The robot ignores both, so the same hook works with or without the broker. Point it at the broker:

```bash
TINY_ENGINEER_URL=http://bgd-ws-01:8790
```

## Running it

```bash
cd packages/tiny-engineer-broker
TE_ROBOT_URL=http://192.168.1.164 node bin/tiny-engineer-broker.js
```

Docker (BGD-WS-01): `packages/tiny-engineer-broker/compose.yaml`. Put `TE_ROBOT_TOKEN=...` in a `.env` next to it, then `docker compose up -d --build`.
