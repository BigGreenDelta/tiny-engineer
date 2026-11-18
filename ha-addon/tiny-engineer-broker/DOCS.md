# Tiny Engineer face broker

Agent sessions send their animation requests here instead of to the robot. The broker keeps one slot per session and lets the first busy session own the face. `attention` from any session takes the face until you answer that session; alerts from any session play once. Rules: [docs/broker.md](https://github.com/BigGreenDelta/tiny-engineer/blob/esp32dev-port/docs/broker.md).

Point hooks at it: `TINY_ENGINEER_URL=http://<ha host>:8790`.

The "Face broker" sidebar panel shows who owns the face, every session, the queue and a log.

Options:

- `robot_url`: robot base URL.
- `robot_token`: the robot's `access_token`. Set one on the robot and give it only to the broker, so nothing else can write to the face.
- `state_ttl_s`: a state with no new request for this long ends.
- `attention_repeat_s`: after the robot's own 60 s attention wait ends, show it again this long after the last send; 0 shows it once.
- `attention_max_s`: a pending attention is dropped after this long.
