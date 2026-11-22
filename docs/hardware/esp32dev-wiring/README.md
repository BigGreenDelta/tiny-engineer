# esp32dev wiring guide (classic ESP32 DevKit V1)

Wiring for the `esp32dev` / `esp32dev-ota` firmware builds: the classic 30-pin ESP32 DevKit V1 (ESP32-D0WD-V3, CP2102 USB-serial, micro-USB), five SG90 servos driven straight from LEDC GPIOs (no PCA9685), and a 0.96" 128x64 SSD1306 I2C OLED. No speaker.

This page is the pin map. The build happens in two stages:

| Stage | What | Soldering | Guide |
| --- | --- | --- | --- |
| A | Breadboard test: 1-2 servos powered from the ESP32 `VIN` pin | none | [stage-a-breadboard.md](stage-a-breadboard.md) |
| B | Final: all 5 servos on a separate 5 V USB-C rail, OLED, on a perfboard | yes | [stage-b-perfboard.md](stage-b-perfboard.md) |

Also here: [schematic.svg](schematic.svg) (the circuit), [checklist.md](checklist.md) (safety, read before each power-up), and [gen_diagrams.py](gen_diagrams.py), which draws all three SVGs from one table of holes and wires and checks it (`python docs/hardware/esp32dev-wiring/gen_diagrams.py`). Change the layout there, not in the SVGs.

## How to read the board

Hold the DevKit with the components facing you, the metal antenna end at the top and the micro-USB socket at the bottom. Each long edge has 15 pins. Pin names are printed on the board next to each pin. "Left row, 6th from top" means: the left edge, counting down from the antenna end.

| # from top | Left row | Right row |
| --- | --- | --- |
| 1 | EN | D23 |
| 2 | VP | D22 |
| 3 | VN | TX0 |
| 4 | D34 | RX0 |
| 5 | D35 | D21 |
| 6 | D32 | D19 |
| 7 | D33 | D18 |
| 8 | D25 | D5 |
| 9 | D26 | TX2 |
| 10 | D27 | RX2 |
| 11 | D14 | D4 |
| 12 | D12 | D2 |
| 13 | D13 | D15 |
| 14 | GND | GND |
| 15 | VIN | 3V3 |

`D18` on the board is `GPIO18` in the firmware, and so on. `VIN` is the 5 V pin (some boards print `5V`).

## Pin map

### Servos

The firmware addresses servos by index 0-4. The web panel's `Servo control` page (`/servo`) and `POST /test/servo` use the same index.

| Index | Joint (`include/servos.h`) | GPIO | Board label | Where on the DevKit |
| --- | --- | --- | --- | --- |
| 0 | `SERVO_HEAD` (head pitch) | GPIO18 | `D18` | right row, 7th from top |
| 1 | `SERVO_NECK` (neck yaw) | GPIO19 | `D19` | right row, 6th |
| 2 | `SERVO_HAND_LEFT` | GPIO23 | `D23` | right row, 1st |
| 3 | `SERVO_HAND_RIGHT` | GPIO32 | `D32` | left row, 6th |
| 4 | `SERVO_BODY` | GPIO33 | `D33` | left row, 7th |

Each SG90 has a 3-wire lead: **brown = GND, red = +5 V, orange = signal**. Only the orange wire goes to the GPIO.

### OLED (SSD1306, I2C address `0x3C`)

The module's pins are printed on it, in this order: `GND VCC SCL SDA`.

| OLED pin | Goes to | Board label | Where on the DevKit |
| --- | --- | --- | --- |
| GND | GND | `GND` | right row, 14th |
| VCC | 3.3 V | `3V3` | right row, 15th |
| SCL | GPIO22 | `D22` | right row, 2nd |
| SDA | GPIO21 | `D21` | right row, 5th |

Power the OLED from `3V3`, not 5 V: the module's I2C pull-up resistors go to its VCC, so 5 V on VCC would put 5 V on the ESP32's SDA/SCL pins.

### Power and ground

| Net | Stage A (breadboard) | Stage B (final) |
| --- | --- | --- |
| ESP32 power | micro-USB from the PC | micro-USB from the PC |
| Servo +5 V (red) | ESP32 `VIN` pin (5 V from the PC's USB) | USB-C breakout `VBUS`, from a 5 V 3 A charger |
| Servo GND (brown) | ESP32 `GND` | USB-C breakout `GND`, **joined** to ESP32 `GND` |
| ESP32 `VIN` | feeds the servos | **not connected** |
| OLED VCC | ESP32 `3V3` | ESP32 `3V3` |

Grounds are always joined: a signal only means something relative to a shared ground. The two 5 V supplies are never joined.

### Pins the firmware also claims (keep them free)

| GPIO | Use in `esp32dev` firmware |
| --- | --- |
| 0 | `BOOT` button on the board (push-button extension default) |
| 4, 16, 17 | optional discrete RGB status LED (`D4`, `RX2`, `TX2`), 220 ohm per leg |
| 25, 26, 27 | I2S to a MAX98357A amp: reserved, amp not fitted |
| 13, 14 | allowed push-button extension pins |

### Pins avoided on purpose

| GPIO | Why |
| --- | --- |
| 0, 2, 5, 12, 15 | strapping pins: their level at reset changes boot mode or flash voltage |
| 6-11 | wired to the module's SPI flash, not on the header |
| 34, 35, 36 (`VP`), 39 (`VN`) | input only, cannot drive a servo |
| 1, 3 (`TX0`, `RX0`) | USB serial console and flashing |

## Checked against the firmware

`include/pins.h`, `TE_BOARD_ESP32DEV` branch: `SERVO_GPIO = {18, 19, 23, 32, 33}` in the order HEAD, NECK, HAND_LEFT, HAND_RIGHT, BODY (the index constants in `include/servos.h`), `I2C_SDA = 21`, `I2C_SCL = 22`, `OLED_HEIGHT = 64`, `OLED_ADDRESS = 0x3C`. The servos run on LEDC at 50 Hz, 12-bit (`src/hardware/servo_wrapper.cpp`). The config already avoids every strapping, flash and input-only pin, so it needed no change. `pio run -e esp32dev` builds.

Firmware behaviour that matters for wiring:

- A missing OLED is not fatal: boot logs `OLED not found` and carries on.
- At boot the firmware moves all five servo channels to their calibrated middle together. That is the power peak; channels with no servo plugged in do nothing.
- `/servo` and `POST /test/servo` stay inside each servo's saved min/max range.
