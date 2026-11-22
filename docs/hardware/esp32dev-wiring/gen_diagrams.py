"""Generate the esp32dev wiring diagrams from one table of holes and wires.

Run from the repo root:  python docs/hardware/esp32dev-wiring/gen_diagrams.py
Writes stage-a-breadboard.svg, stage-b-perfboard.svg and schematic.svg next to
this file, and checks that no perfboard hole is used twice or by two nets.
Standard library only.
"""

from __future__ import annotations

import math
from pathlib import Path

OUT = Path(__file__).resolve().parent

BG = "#fbfaf7"
GND = "#6d4c41"  # brown, as the SG90 lead
V5 = "#e53935"  # red, +5 V
SIG = "#fb8c00"  # orange, servo signal
V33 = "#8e24aa"  # purple, 3.3 V
SCL = "#1e88e5"  # blue
SDA = "#43a047"  # green
PIN = "#d4af37"
FONT = 'font-family="DejaVu Sans, Arial, sans-serif"'

# DevKit V1, 30 pins, antenna at the top, components facing you.
LEFT_ROW = ["EN", "VP", "VN", "D34", "D35", "D32", "D33", "D25", "D26", "D27",
            "D14", "D12", "D13", "GND", "VIN"]
RIGHT_ROW = ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "TX2", "RX2",
             "D4", "D2", "D15", "GND", "3V3"]

# index, joint, board label
SERVOS = [
    (0, "HEAD", "D18"),
    (1, "NECK", "D19"),
    (2, "HAND_LEFT", "D23"),
    (3, "HAND_RIGHT", "D32"),
    (4, "BODY", "D33"),
]


class Svg:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.parts: list[str] = []

    def add(self, s: str) -> None:
        self.parts.append(s)

    def text(self, x, y, s, size=13, anchor="start", fill="#000", weight="normal",
             extra=""):
        s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        self.add(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" '
                 f'font-size="{size}" font-weight="{weight}" fill="{fill}"{extra}>{s}</text>')

    def label(self, x, y, s, size=11, anchor="start", fill="#000", weight="normal"):
        w = len(s) * size * 0.62 + 6
        bx = {"start": x - 3, "middle": x - w / 2, "end": x - w + 3}[anchor]
        self.rect(bx, y - size, w, size + 5, BG, extra=' fill-opacity="0.88"', rx=2)
        self.text(x, y, s, size, anchor, fill, weight)

    def rect(self, x, y, w, h, fill="none", stroke="none", sw=1, rx=0, extra=""):
        self.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                 f'rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{extra}/>')

    def circle(self, x, y, r, fill="none", stroke="none", sw=1, extra=""):
        self.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{extra}/>')

    def line(self, x1, y1, x2, y2, stroke="#000", sw=2, extra=""):
        self.add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{extra}/>')

    def poly(self, pts, stroke, sw=4, halo=True, dash=""):
        p = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        d = f' stroke-dasharray="{dash}"' if dash else ""
        if halo:
            self.add(f'<polyline points="{p}" fill="none" stroke="{BG}" '
                     f'stroke-width="{sw + 5}" stroke-linejoin="round" stroke-linecap="round"/>')
        self.add(f'<polyline points="{p}" fill="none" stroke="{stroke}" stroke-width="{sw}" '
                 f'stroke-linejoin="round" stroke-linecap="round"{d}/>')

    def curve(self, p0, p1, c0, c1, stroke, sw=4):
        d = (f"M{p0[0]:.1f},{p0[1]:.1f} C{c0[0]:.1f},{c0[1]:.1f} "
             f"{c1[0]:.1f},{c1[1]:.1f} {p1[0]:.1f},{p1[1]:.1f}")
        self.add(f'<path d="{d}" fill="none" stroke="{BG}" stroke-width="{sw + 5}" '
                 f'stroke-linecap="round"/>')
        self.add(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" '
                 f'stroke-linecap="round"/>')

    def save(self, name: str) -> None:
        body = "\n".join(self.parts)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
               f'{FONT} font-size="13">\n<rect width="{self.w}" height="{self.h}" fill="{BG}"/>\n'
               f"{body}\n</svg>\n")
        (OUT / name).write_text(svg, encoding="utf-8")
        print("wrote", OUT / name)


# ---------------------------------------------------------------- Stage A ---

def stage_a() -> None:
    s = Svg(1240, 960)
    p = 24
    y0 = 125

    def ry(r):
        return y0 + (r - 1) * p

    cols = "abcdefghij"

    def bx(board_xa, c):
        i = cols.index(c)
        return board_xa + i * p + (p if i >= 5 else 0)

    left_a, right_a = 40, 40 + 240 + 216

    def L(c, r):
        return bx(left_a, c), ry(r)

    def R(c, r):
        return bx(right_a, c), ry(r)

    s.text(620, 32, "Stage A: 2 servos on the breadboard, no soldering", 19, "middle",
           weight="bold")
    s.text(620, 54, "Two 400-hole breadboards side by side, ESP32 across both. Holes a-e of one "
           "row are joined; so are f-j. The channel between e and f separates them.", 13,
           "middle", "#444")

    for xa, name in ((left_a, "left breadboard"), (right_a, "right breadboard")):
        s.rect(xa - 26, y0 - 26, 292, 24 * p + 20, "#f1efe9", "#bbb", rx=8)
        s.rect(xa + 4 * p + 15, y0 - 20, 14, 24 * p + 8, "#dcd8cf")
        s.text(xa + 120, y0 + 24 * p + 14, name, 12, "middle", "#777")
        for c in cols:
            s.text(bx(xa, c), y0 - 32, c, 12, "middle", "#777")
        for r in range(1, 25):
            for c in cols:
                s.rect(bx(xa, c) - 4, ry(r) - 4, 8, 8, "#555", rx=1.5)
    for r in range(1, 25):
        s.text(right_a + 266, ry(r) + 4, str(r), 10, "middle", "#999")
        s.text(left_a - 34, ry(r) + 4, str(r), 10, "middle", "#999")

    # ESP32 across both boards
    xl, xr = bx(left_a, "j"), right_a
    s.rect(xl - 16, ry(1) - 62, xr - xl + 32, ry(15) - ry(1) + 124, "#2b2f36", rx=10,
           extra=' opacity="0.93"')
    s.rect(xl + 40, ry(1) - 56, xr - xl - 80, 40, "#9aa0a6", rx=4)
    s.text((xl + xr) / 2, ry(1) - 31, "antenna end", 12, "middle", "#2b2f36")
    s.rect((xl + xr) / 2 - 28, ry(15) + 34, 56, 26, "#c9ccd1", rx=3)
    s.text((xl + xr) / 2, ry(15) + 52, "USB", 11, "middle")
    s.text((xl + xr) / 2, ry(8), "ESP32 DevKit V1", 13, "middle", "#fff", "bold")
    s.text((xl + xr) / 2, ry(9), "(seen from above)", 11, "middle", "#cfd3d8")
    used = {"VIN": V5, "GND": GND, "D18": SIG, "D19": SIG}
    for i, name in enumerate(LEFT_ROW):
        r = i + 1
        hl = name in used and (name != "GND")
        col = used.get(name, PIN) if hl else PIN
        s.circle(xl, ry(r), 6 if hl else 5, col, "#fff", 1.5 if hl else 0)
        s.text(xl + 14, ry(r) + 4, name, 12, fill="#fff" if hl else "#cfd3d8",
               weight="bold" if hl else "normal")
    for i, name in enumerate(RIGHT_ROW):
        r = i + 1
        hl = name in ("D18", "D19") or (name == "GND")
        col = used.get(name, PIN) if hl else PIN
        s.circle(xr, ry(r), 6 if hl else 5, col, "#fff", 1.5 if hl else 0)
        s.text(xr - 14, ry(r) + 4, name, 12, "end", fill="#fff" if hl else "#cfd3d8",
               weight="bold" if hl else "normal")

    def dot(pt, col):
        s.circle(pt[0], pt[1], 4.5, col, "#fff", 1)

    # power jumpers
    a, b = L("g", 15), R("a", 20)
    s.curve(a, b, (a[0], ry(21)), (b[0] - 60, ry(23)), V5)
    dot(a, V5)
    dot(b, V5)
    a, b = R("e", 14), R("b", 22)
    s.curve(a, b, (R("e", 16)[0], ry(16)), (R("e", 22)[0], ry(24)), GND)
    dot(a, GND)
    dot(b, GND)

    # 1000 uF capacitor, d20 (+) to d22 (-)
    cx, cy = R("d", 21)
    s.line(cx, ry(20), cx, ry(22), "#888", 2)
    s.rect(cx - 13, cy - 15, 26, 30, "#1a237e", "#000", 1, rx=5)
    s.rect(cx - 13, cy + 5, 26, 10, "#9fa8da", rx=2)
    s.text(cx, cy + 13, "-", 11, "middle", "#000", "bold")
    s.text(cx, cy - 3, "+", 11, "middle", "#fff", "bold")
    s.circle(cx, ry(20), 3.5, "#888")
    s.circle(cx, ry(22), 3.5, "#888")

    # servos
    def servo(y, title, sub, holes):
        x0 = 900
        s.rect(x0 + 60, y - 40, 150, 80, "#1565c0", "#0d47a1", 2, rx=6)
        s.circle(x0 + 100, y, 18, "#fff", "#0d47a1", 2)
        s.text(x0 + 165, y - 6, "SG90", 13, "middle", "#fff", "bold")
        s.text(x0 + 165, y + 12, title, 11, "middle", "#fff")
        s.text(x0 + 135, y + 58, sub, 11, "middle", "#333")
        # plug with three sockets
        s.rect(x0 - 8, y - 34, 20, 68, "#222", rx=3)
        for k, col in enumerate((GND, V5, SIG)):
            yy = y - 22 + k * 22
            s.line(x0 + 12, yy, x0 + 60, yy, col, 4)
            s.rect(x0 - 3, yy - 5, 10, 10, "#000", col, 1.5)
            a = holes[k]
            s.curve(a, (x0 - 3, yy), (a[0] + 180, a[1]), (x0 - 140, yy), col, 3.5)
            dot(a, col)
            s.circle(x0 + 2, yy, 3, col)

    servo(ry(15), "servo 0 HEAD", "plug: brown, red, orange",
          [R("c", 22), R("c", 20), R("e", 7)])
    servo(ry(22), "servo 1 NECK", "plug: brown, red, orange",
          [R("e", 22), R("e", 20), R("e", 6)])

    # notes
    x, y = 40, 770
    s.text(x, y, "Jumper wires (male-male; push one end into the servo plug):", 13, weight="bold")
    rows = [
        (V5, "red", "left board g15 (VIN row) -> right board a20   = 5 V from the PC's USB"),
        (GND, "brown", "right board e14 (GND row) -> right board b22"),
        (V5, "red", "c20 -> HEAD servo red,    e20 -> NECK servo red"),
        (GND, "brown", "c22 -> HEAD servo brown,  e22 -> NECK servo brown"),
        (SIG, "orange", "e7 (D18) -> HEAD servo orange,   e6 (D19) -> NECK servo orange"),
    ]
    for i, (col, cname, t) in enumerate(rows):
        yy = y + 24 + i * 22
        s.line(x, yy - 4, x + 28, yy - 4, col, 5)
        s.text(x + 38, yy, f"{cname:7s} {t}", 13, extra=' xml:space="preserve"')
    s.text(x + 640, y, "1000 uF capacitor:", 13, weight="bold")
    s.text(x + 640, y + 24, "long leg (+) in d20, striped leg (-) in d22.", 13)
    s.text(x + 640, y + 46, "Row 20 a-e is now +5 V, row 22 a-e is GND.", 13)
    s.text(x + 640, y + 80, "Servo plugs are female: the jumper's male", 13)
    s.text(x + 640, y + 102, "pin goes into the matching colour socket.", 13)
    s.text(620, 935, "Unplug USB while wiring. Start with the HEAD servo only; add NECK once "
           "HEAD works.", 13, "middle", "#b71c1c", "bold")
    s.save("stage-a-breadboard.svg")


# ------------------------------------------------------- Stage A, 5 servos ---

def stage_a5() -> None:
    """All 5 servos + OLED on the two breadboards, servo rail from the kit's
    MB102-type power supply module, never from the ESP32.

    The ESP32 sits in rows 16-30 so its USB socket hangs off the bottom end
    of the boards; the module plugs onto the top end of the right board with
    its sockets facing up, off the board."""
    s = Svg(1560, 1590)
    p = 24
    y0 = 440
    NR = 30
    E = 15  # ESP32 pin 1 (EN / D23) is in row E + 1
    BLUE = "#1e5bd8"

    def ry(r):
        return y0 + (r - 1) * p

    cols = "abcdefghij"

    def bx(xa, c):
        i = cols.index(c)
        return xa + i * p + (p if i >= 5 else 0)

    left_a = 360
    left_j = bx(left_a, "j")
    right_a = left_j + 216
    right_j = bx(right_a, "j")

    def L(c, r):
        return bx(left_a, c), ry(r)

    def R(c, r):
        return bx(right_a, c), ry(r)

    # (x of +, x of -). On his boards every pair has red (+) on the LEFT, blue (-) right.
    rails = {
        "LO": (left_a - 58, left_a - 34),    # left board, outer
        "LI": (left_j + 34, left_j + 58),    # left board, inner
        "RI": (right_a - 58, right_a - 34),  # right board, inner
        "RO": (right_j + 34, right_j + 58),  # right board, outer
    }
    for xp, xm in rails.values():
        assert xp < xm, "red + strip must be left of blue - strip"

    def rail(pair, sign, r):
        xp, xm = rails[pair]
        return (xp if sign == "+" else xm), ry(r)

    s.text(780, 32, "Stage A, all 5 servos + OLED on the breadboards (no soldering)", 19,
           "middle", weight="bold")
    s.text(780, 54, "Servo power comes from the kit's Power Supply Module on its own rail, "
           "never from the ESP32. The ESP32 runs from the PC's USB. Grounds joined.", 13,
           "middle", "#444")
    s.text(780, 74, "Holes a-e of one row are joined; so are f-j. Each rail (+ or -) is one long "
           "strip down the board.", 13, "middle", "#444")

    for xa, xj in ((left_a, left_j), (right_a, right_j)):
        s.rect(xa - 76, y0 - 26, xj - xa + 152, NR * p + 20, "#f1efe9", "#bbb", rx=8)
        s.rect(xa + 4 * p + 15, y0 - 20, 14, NR * p + 8, "#dcd8cf")
        for r in range(1, NR + 1):
            for c in cols:
                s.rect(bx(xa, c) - 4, ry(r) - 4, 8, 8, "#555", rx=1.5)
    for pair, (xp, xm) in rails.items():
        s.line(xp - 9, y0 - 14, xp - 9, ry(NR) + 10, V5, 2)
        s.line(xm + 9 if xm > xp else xm - 9, y0 - 14, xm + 9 if xm > xp else xm - 9,
               ry(NR) + 10, BLUE, 2)
        for r in range(1, NR + 1):
            for x in (xp, xm):
                s.rect(x - 4, ry(r) - 4, 8, 8, "#555", rx=1.5)
    for r in range(1, NR + 1):
        s.text(right_j + 84, ry(r) + 4, str(r), 10, "middle", "#999")
        s.text(left_a - 84, ry(r) + 4, str(r), 10, "middle", "#999")

    def board_labels(y, rails_too):
        for xa in (left_a, right_a):
            for c in cols:
                s.text(bx(xa, c), y, c, 12, "middle", "#777")
        if rails_too:
            for xp, xm in rails.values():
                s.text(xp, y, "+", 14, "middle", V5, "bold")
                s.text(xm, y, "-", 14, "middle", BLUE, "bold")

    board_labels(y0 - 32, True)
    board_labels(ry(NR) + 30, True)
    s.text((left_a + left_j) / 2, ry(NR) + 50, "left breadboard", 12, "middle", "#777", "bold")
    s.text((right_a + right_j) / 2, ry(NR) + 50, "right breadboard", 12, "middle", "#777",
           "bold")

    # ESP32 across both boards, rows 16-30, USB end past the bottom of the boards
    xl, xr = left_j, right_a
    xc = (xl + xr) / 2
    s.rect(xl - 16, ry(E + 1) - 62, xr - xl + 32, ry(E + 15) - ry(E + 1) + 124, "#2b2f36",
           rx=10, extra=' opacity="0.93"')
    s.rect(xl + 40, ry(E + 1) - 56, xr - xl - 80, 40, "#9aa0a6", rx=4)
    s.text(xc, ry(E + 1) - 31, "antenna end", 12, "middle", "#2b2f36")
    usb_y = ry(E + 15) + 34
    s.rect(xc - 28, usb_y, 56, 26, "#c9ccd1", rx=3)
    s.text(xc, usb_y + 18, "USB", 11, "middle")
    # cable: plug body and lead, off the end of the boards
    s.rect(xc - 22, usb_y + 26, 44, 56, "#455a64", "#263238", 1.5, rx=5)
    s.line(xc, usb_y + 82, xc, usb_y + 150, "#455a64", 8, extra=' stroke-linecap="round"')
    s.label(xc + 34, usb_y + 70, "micro-USB cable to the PC:", 11, weight="bold")
    s.label(xc + 34, usb_y + 86, "plugs in past the end of the boards", 11)
    s.text(xc, ry(E + 8), "ESP32 DevKit V1", 13, "middle", "#fff", "bold")
    s.text(xc, ry(E + 9), "(seen from above)", 11, "middle", "#cfd3d8")
    s.text(xc, ry(E + 10) + 4, "inner rails under it:", 10, "middle", "#cfd3d8")
    s.text(xc, ry(E + 11), "not used", 10, "middle", "#cfd3d8")
    hl = {"D32": SIG, "D33": SIG, "D18": SIG, "D19": SIG, "D23": SIG, "D21": SDA, "D22": SCL,
          "3V3": V33}
    for names, x, anchor, dx in ((LEFT_ROW, xl, "start", 14), (RIGHT_ROW, xr, "end", -14)):
        for i, name in enumerate(names):
            col = hl.get(name)
            if name == "GND" and x == xr:
                col = GND
            r = E + 1 + i
            s.circle(x, ry(r), 6 if col else 5, col or PIN, "#fff", 1.5 if col else 0)
            s.text(x + dx, ry(r) + 4, name, 12, anchor,
                   "#fff" if col else "#cfd3d8", "bold" if col else "normal")

    def dot(pt, col):
        s.circle(pt[0], pt[1], 4.5, col, "#fff", 1)

    def jumper(a, b, col, c0=None, c1=None, sw=3.5):
        dx = b[0] - a[0]
        c0 = c0 or (a[0] + dx * 0.5, a[1])
        c1 = c1 or (b[0] - dx * 0.5, b[1])
        s.curve(a, b, c0, c1, col, sw)
        dot(a, col)
        dot(b, col)

    # power supply module on the top end of the right board, sockets facing up
    LEG_ROWS = (4, 5)
    mx0, mx1 = right_a - 80, right_j + 80
    my0, my1 = 200, ry(LEG_ROWS[1]) + 16
    s.rect(mx0, my0, mx1 - mx0, my1 - my0, "#151515", "#000", 2, rx=6,
           extra=' opacity="0.93"')
    s.rect(right_j - 84, my0 - 30, 74, 52, "#c9ccd1", "#888", 1.5, rx=3)
    s.text(right_j - 47, my0 - 2, "USB-A", 11, "middle", "#000", "bold")
    s.rect(right_a + 14, my0 - 34, 56, 56, "#222", "#888", 1.5, rx=6)
    s.text(right_a + 42, my0 - 2, "DC", 11, "middle", "#fff", "bold")
    s.rect(bx(right_a, "e") - 4, my0 + 10, 26, 26, "#ddd", "#888", 1, rx=3)
    s.text(bx(right_a, "e") + 9, my0 + 50, "switch", 9, "middle", "#cfd3d8")
    s.circle(bx(right_a, "c") + 6, my0 + 40, 7, "#2fb34a")
    s.text((mx0 + mx1) / 2, my0 + 84, "kit Power Supply Module", 13, "middle", "#fff", "bold")
    s.text((mx0 + mx1) / 2, my0 + 100, "(MB102 type, marked 545043)", 10, "middle", "#cfd3d8")
    s.text((mx0 + mx1) / 2, my0 + 118, "3.3V / GND / 5V header pins: unused", 9, "middle",
           "#cfd3d8")
    s.text((mx0 + mx1) / 2, my0 + 140, "sockets face outward, off the board", 10, "middle",
           "#cfd3d8")
    for pair in ("RI", "RO"):
        x = (rails[pair][0] + rails[pair][1]) / 2
        s.rect(x - 46, my0 + 156, 92, 32, "#fff", V5, 2, rx=3)
        s.text(x, my0 + 169, "jumper on 5V", 10, "middle", "#000", "bold")
        s.text(x, my0 + 182, "(5V-VCC pair)", 9, "middle", "#000")
    # 4 legs per side: 2 in the + strip, 2 in the - strip
    for pair in ("RI", "RO"):
        for sign in "+-":
            for r in LEG_ROWS:
                x, y = rail(pair, sign, r)
                s.rect(x - 5, y - 5, 10, 10, "#d4af37", "#fff", 1)
        xp, xm = rails[pair]
        s.text(xp, ry(LEG_ROWS[0]) - 12, "+", 13, "middle", "#ff8a80", "bold")
        s.text(xm, ry(LEG_ROWS[0]) - 12, "-", 13, "middle", "#8ab4ff", "bold")
    s.text(right_j - 47, my0 - 62, "IN option 1: 5 V charger,", 11, "middle", "#000", "bold")
    s.text(right_j - 47, my0 - 47, "USB-A to USB-A cable", 11, "middle")
    s.text(right_a + 42, my0 - 62, "IN option 2: kit 9 V", 11, "middle", "#000", "bold")
    s.text(right_a + 42, my0 - 47, "battery (interim, weak)", 11, "middle")

    # rail bridges to the left board, above the ESP32
    jumper(rail("RO", "+", 8), rail("LO", "+", 8), V5,
           (rail("RO", "+", 8)[0] - 200, ry(10)), (rail("LO", "+", 8)[0] + 200, ry(10)))
    jumper(rail("RO", "-", 10), rail("LO", "-", 10), GND,
           (rail("RO", "-", 10)[0] - 200, ry(12)), (rail("LO", "-", 10)[0] + 200, ry(12)))
    # ground join: ESP32 GND row to the servo - rail
    jumper(R("b", E + 14), rail("RO", "-", 28), GND)

    def ecap(pair, r_plus, label, lx, anchor):
        (xp, yp), (xm, ym) = rail(pair, "+", r_plus), rail(pair, "-", r_plus + 1)
        cx, cy = (xp + xm) / 2, (yp + ym) / 2
        s.line(xp, yp, cx, cy, "#888", 2)
        s.line(xm, ym, cx, cy, "#888", 2)
        s.circle(cx, cy, 13, "#1a237e", "#000", 1)
        s.add(f'<path d="M{cx - 13:.1f},{cy:.1f} A13,13 0 0 0 {cx + 13:.1f},{cy:.1f} Z" '
              f'fill="#9fa8da"/>')
        s.circle(xp, yp, 3.5, "#888")
        s.circle(xm, ym, 3.5, "#888")
        s.label(lx, cy + 4, label, 11, anchor, weight="bold")

    def ccap(pair, r, label, lx, anchor):
        (xp, yp), (xm, ym) = rail(pair, "+", r), rail(pair, "-", r)
        s.add(f'<ellipse cx="{(xp + xm) / 2:.1f}" cy="{yp - 9:.1f}" rx="13" ry="7" '
              f'fill="#ffca28" stroke="#b8860b" stroke-width="1.5"/>')
        s.line(xp, yp, xp, yp - 6, "#888", 2)
        s.line(xm, ym, xm, ym - 6, "#888", 2)
        s.label(lx, yp - 5, label, 11, anchor, weight="bold")

    def servo(x0, y, title, holes, mirror=False):
        """x0 = plug x. holes = (brown, red, orange) hole positions."""
        bxs = x0 - 250 if mirror else x0 + 60
        s.rect(bxs, y - 40, 190, 80, "#1565c0", "#0d47a1", 2, rx=6)
        s.circle(bxs + (160 if mirror else 30), y, 16, "#fff", "#0d47a1", 2)
        tx = bxs + (72 if mirror else 118)
        s.text(tx, y - 6, "SG90", 13, "middle", "#fff", "bold")
        s.text(tx, y + 12, title, 11, "middle", "#fff")
        s.rect(x0 - 8, y - 34, 20, 68, "#222", rx=3)
        for k, col in enumerate((GND, V5, SIG)):
            yy = y - 22 + k * 22
            if mirror:
                s.line(x0 - 60, yy, x0 - 8, yy, col, 4)
            else:
                s.line(x0 + 12, yy, x0 + 60, yy, col, 4)
            s.rect(x0 - 3, yy - 5, 10, 10, "#000", col, 1.5)
            jumper(holes[k], (x0 + 2, yy), col)

    # servo signals: D23 row 16, D19 row 21, D18 row 22 (right); D32 row 21, D33 row 22 (left)
    sx = 1300
    servo(sx, ry(15), "servo 2 HAND_LEFT",
          (rail("RO", "-", 15), rail("RO", "+", 15), R("e", E + 1)))
    servo(sx, ry(21), "servo 1 NECK",
          (rail("RO", "-", 20), rail("RO", "+", 20), R("e", E + 6)))
    servo(sx, ry(27), "servo 0 HEAD",
          (rail("RO", "-", 25), rail("RO", "+", 25), R("e", E + 7)))
    lx = 270
    servo(lx, ry(17), "servo 3 HAND_RIGHT",
          (rail("LO", "-", 17), rail("LO", "+", 17), L("f", E + 6)), mirror=True)
    servo(lx, ry(25), "servo 4 BODY",
          (rail("LO", "-", 25), rail("LO", "+", 25), L("f", E + 7)), mirror=True)

    # OLED on female-to-male wires, below the right board
    ox, oy = 1330, ry(NR) + 40
    s.rect(ox, oy + 20, 120, 62, "#0d47a1", "#000", 1.5, rx=5)
    s.rect(ox + 40, oy + 28, 74, 46, "#111", rx=2)
    s.text(ox + 77, oy + 56, "OLED", 11, "middle", "#fff", "bold")
    for k, (name, col, hole) in enumerate((("GND", GND, R("d", E + 14)),
                                           ("VCC", V33, R("d", E + 15)),
                                           ("SCL", SCL, R("d", E + 2)),
                                           ("SDA", SDA, R("d", E + 5)))):
        py = oy + 30 + k * 13
        s.circle(ox + 8, py, 3, "#d4af37")
        s.text(ox + 15, py + 4, name, 8, "start", "#fff", "bold")
        jumper(hole, (ox + 8, py), col, sw=3)
    s.text(ox + 60, oy + 100, "OLED on 4 female-to-male wires", 10, "middle", "#333")

    ecap("RO", 12, "C1 1000 uF", rails["RO"][1] + 18, "start")
    ccap("RO", 7, "C2 0.1 uF", rails["RO"][1] + 18, "start")
    ccap("LO", 20, "C3 0.1 uF", rails["LO"][1] - 18, "end")

    # notes
    x, y = 40, ry(NR) + 190
    s.text(x, y, "Jumpers (holes on the RIGHT board unless marked L):", 13, weight="bold")
    rows = [
        (V5, "rail bridge: right outer + row 8 -> L outer + row 8"),
        (GND, "rail bridge: right outer - row 10 -> L outer - row 10"),
        (GND, "ground join: b29 (ESP32 GND row) -> right outer - rail"),
        (SIG, "signals: e22 D18 -> servo 0, e21 D19 -> servo 1, e16 D23 -> servo 2,"),
        (SIG, "         L f21 D32 -> servo 3, L f22 D33 -> servo 4"),
        (V5, "each servo red -> + rail, brown -> - rail next to it"),
        (V33, "OLED: GND d29, VCC d30 (3V3), SCL d17 (D22), SDA d20 (D21)"),
    ]
    for i, (col, tx) in enumerate(rows):
        yy = y + 24 + i * 21
        s.line(x, yy - 4, x + 28, yy - 4, col, 5)
        s.text(x + 38, yy, tx, 12, extra=' xml:space="preserve"')
    x2 = 800
    s.text(x2, y, "Placement and module settings:", 13, weight="bold")
    notes = [
        "ESP32 in rows 16-30 (EN / D23 in row 16): its USB hangs off the bottom end.",
        "Module on the TOP end of the right board, sockets facing up, off the board.",
        "Its 4 legs per side: 2 in the red + strip, 2 in the blue - strip, rows 4-5.",
        "Every rail pair here: red + strip on the left, blue - strip on the right.",
        "Both jumpers on 5V (5V-VCC pair): both rail pairs of the right board are 5 V.",
        "The inner pair runs under the ESP32: plug nothing of the ESP32 into it. Switch IN.",
        "Meter the rail before plugging servos: ~5 V. 9 V battery: ~700 mA at most.",
        "C1: long leg in the + rail (row 12), striped leg in the - rail (row 13).",
    ]
    for i, tx in enumerate(notes):
        s.text(x2, y + 24 + i * 21, tx, 12)
    s.text(780, 1570, "Unplug USB and the module's power while wiring. Plug servos one at a "
           "time, test each on the Servo control page.", 13, "middle", "#b71c1c", "bold")
    s.save("stage-a5-breadboard.svg")


# ---------------------------------------------------------------- Stage B ---

COLS = "ABCDEFGHIJKLMNOPQR"  # 18 columns x 24 rows (5 x 7 cm board)
NROWS = 24


def h(name: str) -> tuple[int, int]:
    """'M16' -> (13, 16): 1-based column and row."""
    return COLS.index(name[0]) + 1, int(name[1:])


# Parts on the top side: hole -> (part, pin, net)
PARTS: dict[str, tuple[str, str, str]] = {}


def place(hole, part, pin, net):
    assert hole not in PARTS, f"hole {hole} used twice ({PARTS.get(hole)} / {part})"
    PARTS[hole] = (part, pin, net)


ESP_NET = {"D18": "SIG0", "D19": "SIG1", "D23": "SIG2", "D32": "SIG3", "D33": "SIG4",
           "D21": "SDA", "D22": "SCL", "GND": "GND", "3V3": "3V3", "VIN": "NC_VIN"}
for i, pin in enumerate(LEFT_ROW):
    place(f"C{10 + i}", "ESP32 left header", pin, ESP_NET.get(pin, "-"))
for i, pin in enumerate(RIGHT_ROW):
    place(f"M{10 + i}", "ESP32 right header", pin, ESP_NET.get(pin, "-"))

# servo headers: column -> servo index
SERVO_COL = {"B": 3, "D": 4, "F": 0, "H": 1, "J": 2}
for c, idx in SERVO_COL.items():
    place(f"{c}2", f"S{idx}", "brown GND", "SERVO_GND")
    place(f"{c}3", f"S{idx}", "red +5V", "SERVO_5V")
    place(f"{c}4", f"S{idx}", "orange signal", f"SIG{idx}")

place("O2", "C1 1000uF", "- (stripe)", "SERVO_GND")
place("O4", "C1 1000uF", "+", "SERVO_5V")
place("L2", "C2 0.1uF", "leg", "SERVO_GND")
place("L3", "C2 0.1uF", "leg", "SERVO_5V")
place("N23", "C3 0.1uF", "leg", "GND")
place("N24", "C3 0.1uF", "leg", "3V3")
place("P11", "J6 OLED", "GND", "GND")
place("P12", "J6 OLED", "VCC", "3V3")
place("P13", "J6 OLED", "SCL", "SCL")
place("P14", "J6 OLED", "SDA", "SDA")
place("R2", "USB-C wire", "GND (brown/black)", "SERVO_GND")
place("R4", "USB-C wire", "VBUS (red)", "SERVO_5V")

# Wires on the bottom side: (net, colour, width, gauge, path of holes, note)
WIRES = [
    ("SERVO_GND", GND, 6, "0.5", ["B2", "D2", "F2", "H2", "J2", "L2", "O2", "R2"],
     "servo GND bus"),
    ("SERVO_5V", V5, 6, "0.5", ["B3", "D3", "F3", "H3", "J3", "L3", "N3", "N4", "O4", "R4"],
     "servo +5 V bus"),
    ("GND", GND, 3, "0.2", ["C23", "A23", "A2", "B2"], "ground join: ESP32 GND to servo GND"),
    ("SIG3", SIG, 3, "0.2", ["C15", "B15", "B4"], "D32 to S3 HAND_RIGHT"),
    ("SIG4", SIG, 3, "0.2", ["C16", "D16", "D4"], "D33 to S4 BODY"),
    ("SIG0", SIG, 3, "0.2", ["M16", "K16", "K8", "F8", "F4"], "D18 to S0 HEAD"),
    ("SIG1", SIG, 3, "0.2", ["M15", "L15", "L7", "H7", "H4"], "D19 to S1 NECK"),
    ("SIG2", SIG, 3, "0.2", ["M10", "M6", "J6", "J4"], "D23 to S2 HAND_LEFT"),
    ("SDA", SDA, 3, "0.2", ["M14", "P14"], "D21 to OLED SDA"),
    ("SCL", SCL, 3, "0.2", ["M11", "N11", "N13", "P13"], "D22 to OLED SCL"),
    ("GND", GND, 3, "0.2", ["N23", "R23", "R11", "P11"], "C3 / ESP32 GND to OLED GND"),
    ("3V3", V33, 3, "0.2", ["N24", "Q24", "Q12", "P12"], "C3 / ESP32 3V3 to OLED VCC"),
]

# C3 legs bent over on the bottom onto the header pins next to them
LEG_BENDS = [("N23", "M23"), ("N24", "M24")]

SAME_NET = {("GND", "SERVO_GND")}  # joined by the ground-join wire on purpose


def check() -> None:
    nets = {"SERVO_GND", "SERVO_5V", "GND", "3V3", "SDA", "SCL"} | {f"SIG{i}" for i in range(5)}
    for net, _c, _w, _g, path, note in WIRES:
        for end in (path[0], path[-1]):
            assert end in PARTS, f"{note}: end {end} has no part"
            pnet = PARTS[end][2]
            ok = pnet == net or (net, pnet) in SAME_NET or (pnet, net) in SAME_NET
            assert ok, f"{note}: {end} is {pnet}, wire is {net}"
        for hole in path:
            c, r = h(hole)
            assert 1 <= c <= len(COLS) and 1 <= r <= NROWS, hole
        assert net in nets
    for a, b in LEG_BENDS:
        assert PARTS[a][2] == PARTS[b][2], (a, b)
    for c, idx in SERVO_COL.items():
        pins = [PARTS[f"{c}{r}"][1] for r in (2, 3, 4)]
        assert pins == ["brown GND", "red +5V", "orange signal"], (c, pins)
        label = SERVOS[idx][2]
        esp = [k for k, v in PARTS.items() if v[1] == label and v[0].startswith("ESP32")][0]
        assert any(w[4][0] == esp and w[4][-1] == f"{c}4" for w in WIRES), (c, esp)
    print("perfboard checks passed:", len(PARTS), "holes,", len(WIRES), "wires")


def stage_b() -> None:
    check()
    p = 22
    W, H = 1600, 1180
    s = Svg(W, H)
    top_x0, bot_x0, y0 = 150, 1000, 250

    def xy(hole, mirror=False, x0=None):
        c, r = h(hole)
        if mirror:
            return bot_x0 + (len(COLS) - c) * p, y0 + (r - 1) * p
        return top_x0 + (c - 1) * p, y0 + (r - 1) * p

    s.text(W / 2, 32, "Stage B: final perfboard (5 x 7 cm, 18 x 24 holes)", 19, "middle",
           weight="bold")
    s.text(W / 2, 54, "Parts sit on the TOP. Wires run on the BOTTOM and are soldered there. "
           "Every hole is isolated: only solder and wire join things.", 13, "middle", "#444")

    def grid(x0, mirror):
        s.rect(x0 - 22, y0 - 22, len(COLS) * p + 22, NROWS * p + 22, "#2e7d32", "#1b5e20",
               2, rx=4, extra=' fill-opacity="0.18"')
        for ci, cname in enumerate(COLS):
            x = x0 + ((len(COLS) - 1 - ci) if mirror else ci) * p
            s.text(x, y0 - 30, cname, 11, "middle", "#555", "bold")
            s.label(x, y0 + NROWS * p + 8, cname, 11, "middle", "#555", "bold")
            for r in range(1, NROWS + 1):
                s.circle(x, y0 + (r - 1) * p, 6, "#d9b44a", "#a0822c", 1)
                s.circle(x, y0 + (r - 1) * p, 2.4, "#fff")
        for r in range(1, NROWS + 1):
            s.text(x0 - 32, y0 + (r - 1) * p + 4, str(r), 10, "middle", "#777")
            s.text(x0 + len(COLS) * p + 10, y0 + (r - 1) * p + 4, str(r), 10, "middle", "#777")

    # ------------------------------ top view
    s.text(top_x0 + 187, 92, "TOP (parts side)", 16, "middle", weight="bold")
    grid(top_x0, False)

    # ESP32 outline
    xa, ya = xy("C10")
    xb, yb = xy("M24")
    s.rect(xa - 0.6 * p, ya - 3.4 * p, xb - xa + 1.2 * p, yb - ya + 6.2 * p, "#2b2f36",
           "#2b2f36", 2, rx=8, extra=' fill-opacity="0.10" stroke-dasharray="7 4"')
    s.label((xa + xb) / 2, ya - 2.2 * p, "ESP32 antenna end", 11, "middle", "#333")
    s.label((xa + xb) / 2, ya - 1.2 * p, "(no parts under it)", 10, "middle", "#666")
    s.rect((xa + xb) / 2 - 26, yb + 1.0 * p, 52, 2.2 * p, "#c9ccd1", "#888", 1, rx=3)
    s.text((xa + xb) / 2, yb + 2.3 * p, "micro-USB", 10, "middle")
    s.text((xa + xb) / 2, yb + 4.4 * p, "to the PC (power + data)", 11, "middle", "#333")
    for col_hole, names, anchor, dx in (("C", LEFT_ROW, "start", 11), ("M", RIGHT_ROW, "end", -11)):
        x, _ = xy(f"{col_hole}10")
        s.rect(x - 8, ya - 9, 16, yb - ya + 18, "#222", rx=2)
        for i, name in enumerate(names):
            hx, hy = xy(f"{col_hole}{10 + i}")
            net = ESP_NET.get(name)
            col = {"GND": GND, "3V3": V33, "SDA": SDA, "SCL": SCL}.get(net, SIG if net and
                                                                          net.startswith("SIG")
                                                                          else "#999")
            if name == "VIN":
                col = "#999"
            s.circle(hx, hy, 4, col if net else "#777")
            s.label(hx + dx, hy + 4, name + (" (empty)" if name == "VIN" else ""), 10, anchor,
                   "#000" if net and name != "VIN" else "#777",
                   "bold" if net and name != "VIN" else "normal")
    s.label((xa + xb) / 2, ya + 8.2 * p, "2 female headers", 11, "middle", "#333")
    s.label((xa + xb) / 2, ya + 9.2 * p, "1 x 15 each", 11, "middle", "#333")

    # servo headers and leads
    for c, idx in SERVO_COL.items():
        x2, y2 = xy(f"{c}2")
        s.rect(x2 - 8, y2 - 9, 16, 2 * p + 18, "#222", rx=2)
        for r, col in ((2, GND), (3, V5), (4, SIG)):
            s.circle(*xy(f"{c}{r}"), 4, col)
        joint = SERVOS[idx][1]
        for k, col in enumerate((GND, V5, SIG)):
            s.line(x2 - 5 + k * 5, y2 - 12, x2 - 5 + k * 5, 160, col, 3)
        s.rect(x2 - 9, 140, 18, 22, "#111", rx=2)
        s.text(x2, 132, f"S{idx}", 12, "middle", weight="bold")
        s.text(x2, 118, joint.replace("HAND_", "H_"), 9, "middle", "#333")
    s.text(top_x0 - 40, 150, "servo plugs:", 11, "end", "#333")
    s.text(top_x0 - 40, 164, "brown to row 2", 11, "end", "#333")

    # C1
    cx, cy = xy("O3")
    s.circle(cx, cy, 2.1 * p, "#1a237e", "#000", 1.5, extra=' fill-opacity="0.85"')
    s.add(f'<path d="M{cx - 2.1 * p:.1f},{cy:.1f} A{2.1 * p:.1f},{2.1 * p:.1f} 0 0 1 '
          f'{cx + 2.1 * p:.1f},{cy:.1f} Z" fill="#9fa8da" fill-opacity="0.9"/>')
    s.text(cx, cy - 18, "- - -", 14, "middle", "#000", "bold")
    s.circle(*xy("O2"), 4, GND, "#fff", 1)
    s.circle(*xy("O4"), 4, V5, "#fff", 1)
    s.text(cx, cy + 30, "C1", 12, "middle", "#fff", "bold")
    s.text(cx + 10, y0 - 92, "C1 1000 uF 16 V", 11, "middle", weight="bold")
    s.text(cx + 10, y0 - 78, "stripe (-) in O2", 11, "middle")
    s.text(cx + 10, y0 - 64, "long leg (+) in O4", 11, "middle")

    def small_cap(a, b, label, lx, ly, anchor="start"):
        (x1, y1), (x2, y2) = xy(a), xy(b)
        s.add(f'<ellipse cx="{(x1 + x2) / 2:.1f}" cy="{(y1 + y2) / 2:.1f}" rx="8" ry="15" '
              f'fill="#ffca28" stroke="#b8860b" stroke-width="1.5"/>')
        s.text((x1 + x2) / 2, (y1 + y2) / 2 + 4, "104", 7, "middle")
        s.label(lx, ly, label, 11, anchor, weight="bold")

    small_cap("L2", "L3", "C2 0.1 uF", xy("L5")[0], xy("L5")[1] + 4, "middle")
    small_cap("N23", "N24", "C3 0.1 uF", xy("O21")[0], xy("O21")[1] + 4)

    # J6 and OLED
    x11, y11 = xy("P11")
    s.rect(x11 - 8, y11 - 9, 16, 3 * p + 18, "#222", rx=2)
    olx = top_x0 + len(COLS) * p + 70
    s.rect(olx, y11 - 30, 130, 120, "#0d47a1", "#000", 1.5, rx=6)
    s.rect(olx + 42, y11 - 6, 78, 72, "#111", rx=2)
    s.text(olx + 81, y11 + 34, "OLED", 12, "middle", "#fff", "bold")
    for k, (name, col) in enumerate((("GND", GND), ("VCC", V33), ("SCL", SCL), ("SDA", SDA))):
        hx, hy = xy(f"P{11 + k}")
        s.circle(hx, hy, 4, col)
        s.line(hx, hy, olx + 4, hy, col, 2.5)
        s.circle(olx + 4, hy, 3, "#d4af37")
        s.text(olx + 10, hy + 4, name, 9, "start", "#fff", "bold")
    s.text(olx + 60, y11 + 108, "J6 = 1 x 4 male header", 10, "middle")
    s.text(olx + 60, y11 + 122, "straight 4-wire cable", 10, "middle")
    s.text(olx + 60, y11 + 136, "GND to GND ... SDA to SDA", 10, "middle")

    # USB-C breakout
    ubx = top_x0 + len(COLS) * p + 130
    uby = y0 + 10
    s.rect(ubx, uby, 120, 70, "#455a64", "#000", 1.5, rx=5)
    s.rect(ubx + 96, uby + 22, 30, 26, "#b0bec5", "#000", 1, rx=4)
    s.text(ubx + 50, uby + 22, "USB-C", 12, "middle", "#fff", "bold")
    s.text(ubx + 50, uby + 38, "breakout", 11, "middle", "#fff")
    s.text(ubx + 50, uby + 54, "5.1k on CC1+CC2", 9, "middle", "#fff")
    s.text(ubx + 60, uby + 88, "to the 5 V 3 A charger", 10, "middle")
    for hole, col, lab, yy in (("R2", GND, "GND", uby + 18), ("R4", V5, "VBUS", uby + 44)):
        hx, hy = xy(hole)
        s.circle(hx, hy, 4, col)
        s.poly([(hx, hy), (hx + 22, hy), (ubx - 20, yy), (ubx, yy)], col, 4, halo=False)
        s.text(ubx - 6, yy - 6, lab, 10, "end", "#333", "bold")

    # ------------------------------ bottom view
    s.text(bot_x0 + 187, 92, "BOTTOM (solder side), board flipped over", 16, "middle",
           weight="bold")
    s.text(bot_x0 + 187, 112, "left and right are swapped: column R is now on the left", 12,
           "middle", "#b71c1c")
    grid(bot_x0, True)
    for hole, (part, _pin, net) in PARTS.items():
        x, y = xy(hole, True)
        if part.startswith("ESP32") and net == "-":
            s.rect(x - 3, y - 3, 6, 6, "#9e9e9e")
        elif net == "NC_VIN":
            s.rect(x - 3, y - 3, 6, 6, "#9e9e9e")
            pass
        else:
            s.rect(x - 3.5, y - 3.5, 7, 7, "#616161")
    for a, b in LEG_BENDS:
        (x1, y1), (x2, y2) = xy(a, True), xy(b, True)
        s.line(x1, y1, x2, y2, "#9e9e9e", 3, extra=' stroke-linecap="round"')
    for net, col, sw, _g, path, _note in WIRES:
        pts = [xy(hh, True) for hh in path]
        s.poly(pts, col, sw, halo=(net == "3V3"))
        for pt in (pts[0], pts[-1]):
            s.circle(pt[0], pt[1], 3.2 if sw < 5 else 4, col, "#fff", 1)
    # labels on the bottom view
    for c, idx in SERVO_COL.items():
        x, y = xy(f"{c}2", True)
        s.text(x, y0 - 46, f"S{idx}", 11, "middle", "#333", "bold")
    for hole, lab in (("R2", "GND in"), ("R4", "5 V in")):
        x, y = xy(hole, True)
        s.text(bot_x0 - 46, y + 4, lab, 11, "end", "#333", "bold")
    s.text(xy("P11", True)[0] + 12, xy("P11", True)[1] - 10, "J6", 10, "start", "#333", "bold")
    yb2 = y0 + NROWS * p + 30
    s.text(bot_x0 + 187, yb2, "Grey bars at N23-M23 and N24-M24: C3's legs bent over onto the "
           "header pins.", 11, "middle", "#555")
    s.text(bot_x0 + 187, yb2 + 16, "C24 (VIN) gets no wire. Grey squares: pin stubs with "
           "nothing soldered to them except the header itself.", 11, "middle", "#555")

    # legend
    ly = y0 + NROWS * p + 140
    s.text(80, ly, "Wire colours (bottom side):", 13, weight="bold")
    leg = [
        (GND, 6, "servo GND bus, 0.5 mm2 (20 AWG): B2 D2 F2 H2 J2 L2 O2 R2"),
        (V5, 6, "servo +5 V bus, 0.5 mm2 (20 AWG): B3 D3 F3 H3 J3 L3 O4 R4"),
        (GND, 3, "ground join and OLED GND, 0.2 mm2 (24 AWG)"),
        (SIG, 3, "servo signals, 0.2 mm2 (24 AWG)"),
        (V33, 3, "3.3 V to the OLED"),
        (SCL, 3, "SCL (D22)"),
        (SDA, 3, "SDA (D21)"),
    ]
    for i, (col, sw, t) in enumerate(leg):
        yy = ly + 22 + i * 20
        s.line(80, yy - 4, 112, yy - 4, col, sw)
        s.text(122, yy, t, 12)
    s.text(830, ly, "Rules:", 13, weight="bold")
    rules = [
        "Wires lie flat on the bottom and are soldered only at their two ends,",
        "onto the pin stub that pokes through (lap joint). Insulated wire may",
        "cross other wires and pads; a bare end must touch only its own pin.",
        "Bus wires are short pieces, pin to pin, in the order listed.",
        "VIN (C24) stays empty: the ESP32 runs from its own USB cable.",
        "Before any power: meter on beep, red probe R4, black R2: no beep.",
    ]
    for i, t in enumerate(rules):
        s.text(830, ly + 22 + i * 20, t, 12)
    s.save("stage-b-perfboard.svg")


# -------------------------------------------------------------- schematic ---

def schematic() -> None:
    s = Svg(1400, 900)
    s.text(700, 32, "tiny-engineer esp32dev: schematic (Stage B)", 19, "middle", weight="bold")
    s.text(700, 54, "A dot is a connection. Lines that cross with a hop are NOT connected.", 13,
           "middle", "#444")
    y5, yg = 160, 215
    xs = [470 + i * 170 for i in range(5)]

    # rails
    s.line(250, y5, xs[-1] + 60, y5, V5, 4)
    s.line(250, yg, xs[-1] + 60, yg, GND, 4)
    s.text(xs[-1] + 70, y5 + 5, "SERVO_5V", 13, fill=V5, weight="bold")
    s.text(xs[-1] + 70, yg + 5, "GND", 13, fill=GND, weight="bold")

    # USB-C breakout
    s.rect(60, 120, 190, 150, "#eceff1", "#455a64", 2, rx=6)
    s.text(155, 142, "USB-C breakout", 13, "middle", weight="bold")
    s.text(155, 158, "(6-pin socket)", 11, "middle", "#555")
    s.text(240, y5 + 4, "VBUS", 12, "end")
    s.text(240, yg + 4, "GND", 12, "end")
    for k, lab in enumerate(("CC1", "CC2")):
        x = 90 + k * 50
        s.text(x, 186, lab, 10, "middle")
        s.rect(x - 5, 192, 10, 26, "#fff", "#000", 1.2)
        s.text(x + 9, 210, "5.1k", 8)
        s.line(x, 218, x, 236, "#000", 1.2)
        s.line(x - 7, 236, x + 7, 236, "#000", 1.5)
    s.text(155, 258, "on the board already", 10, "middle", "#555")
    s.text(155, 300, "plugs into a 5 V 3 A charger", 11, "middle", "#333")
    s.circle(250, y5, 5, V5)
    s.circle(250, yg, 5, GND)

    def cap(x, label, polar):
        s.circle(x, y5, 5, V5)
        s.circle(x, yg, 5, GND)
        s.line(x, y5, x, 182, "#000", 2)
        s.line(x, 194, x, yg, "#000", 2)
        s.line(x - 12, 182, x + 12, 182, "#000", 2.5)
        if polar:
            s.add(f'<path d="M{x - 12},197 Q{x},189 {x + 12},197" fill="none" stroke="#000" '
                  f'stroke-width="2.5"/>')
            s.text(x - 15, 178, "+", 12, "end", weight="bold")
        else:
            s.line(x - 12, 194, x + 12, 194, "#000", 2.5)
        s.text(x, 245, label, 11, "middle")

    cap(305, "C1 1000uF", True)
    cap(385, "C2 0.1uF", False)

    # servos
    esp_top = 520
    for i, x in enumerate(xs):
        idx, joint, lab = SERVOS[i]
        s.rect(x - 55, 290, 110, 80, "#e3f2fd", "#1565c0", 2, rx=6)
        s.text(x, 318, f"servo {idx}", 13, "middle", weight="bold")
        s.text(x, 336, joint, 12, "middle")
        s.text(x, 352, "SG90", 10, "middle", "#555")
        # +5 V pin (left), GND pin (right), signal (bottom)
        xp, xg = x - 30, x + 30
        s.circle(xp, y5, 5, V5)
        s.add(f'<path d="M{xp},{y5} L{xp},{yg - 8} A8,8 0 0 1 {xp},{yg + 8} L{xp},290" '
              f'fill="none" stroke="{V5}" stroke-width="2.5"/>')
        s.text(xp - 4, 284, "red", 9, "end", V5)
        s.circle(xg, yg, 5, GND)
        s.line(xg, yg, xg, 290, GND, 2.5)
        s.text(xg + 4, 284, "brown", 9, "start", GND)
        s.line(x, 370, x, esp_top, SIG, 2.5)
        s.text(x + 5, 392, "orange", 9, "start", SIG)

    # ESP32 block
    ex0, ex1, ey1 = 400, 1205, 730
    s.rect(ex0, esp_top, ex1 - ex0, ey1 - esp_top, "#f5f5f5", "#2b2f36", 2.5, rx=8)
    s.text((ex0 + ex1) / 2, 610, "ESP32 DevKit V1 (ESP32-D0WD-V3)", 15, "middle", weight="bold")
    s.text((ex0 + ex1) / 2, 630, "board labels shown, GPIO number in brackets", 11, "middle",
           "#555")
    for i, x in enumerate(xs):
        lab = SERVOS[i][2]
        s.circle(x, esp_top, 4, SIG)
        s.text(x, esp_top + 20, f"{lab} (GPIO{lab[1:]})", 11, "middle")
    # right edge to OLED
    ox = 1275
    rows = [("GND", GND, 580), ("3V3", V33, 615), ("D22 (GPIO22)", SCL, 650),
            ("D21 (GPIO21)", SDA, 685)]
    s.rect(ox, 550, 110, 160, "#e3f2fd", "#0d47a1", 2, rx=6)
    s.text(ox + 55, 735, "OLED SSD1306", 12, "middle", weight="bold")
    s.text(ox + 55, 751, "128x64, I2C 0x3C", 10, "middle", "#555")
    for (lab, col, y), olab in zip(rows, ("GND", "VCC", "SCL", "SDA")):
        s.line(ex1, y, ox, y, col, 2.5)
        s.text(ex1 - 8, y + 4, lab, 11, "end")
        s.text(ox + 8, y + 4, olab, 11)
    # C3 between 3V3 and GND
    cx = 1238
    s.circle(cx, 580, 4, GND)
    s.circle(cx, 615, 4, V33)
    s.text(cx, 570, "C3 0.1uF", 10, "middle")
    s.line(cx - 8, 594, cx + 8, 594, "#000", 2)
    s.line(cx - 8, 601, cx + 8, 601, "#000", 2)
    s.line(cx, 580, cx, 594, "#000", 1.5)
    s.line(cx, 601, cx, 615, "#000", 1.5)
    # left edge: VIN (no connection), GND join
    s.text(ex0 + 10, 590, "VIN", 12, weight="bold")
    s.line(ex0 - 40, 586, ex0, 586, "#999", 2)
    s.line(ex0 - 48, 578, ex0 - 32, 594, "#c62828", 3)
    s.line(ex0 - 48, 594, ex0 - 32, 578, "#c62828", 3)
    s.text(ex0 - 40, 616, "not connected", 11, "middle", "#c62828", "bold")
    s.text(ex0 + 10, 690, "GND", 12, weight="bold")
    s.line(ex0, 686, 270, 686, GND, 3)
    s.add(f'<polyline points="270,686 270,{yg}" fill="none" stroke="{GND}" stroke-width="3"/>')
    s.circle(270, yg, 6, GND)
    s.text(262, 450, "the only", 11, "end", GND, "bold")
    s.text(262, 465, "ground join", 11, "end", GND, "bold")
    # USB to PC
    s.rect(760, ey1, 60, 20, "#c9ccd1", "#555", 1, rx=3)
    s.text(790, ey1 + 40, "micro-USB to the PC: ESP32 power + flashing + serial", 12, "middle")
    s.text(700, 830, "Two 5 V sources, never joined: the charger feeds only SERVO_5V, the PC "
           "feeds only the ESP32. Grounds are joined once.", 13, "middle", "#b71c1c", "bold")
    s.text(700, 855, "Stage A (breadboard) differs in one place: SERVO_5V comes from the ESP32 "
           "VIN pin instead of the USB-C breakout, with 1-2 servos only.", 12, "middle", "#333")
    s.save("schematic.svg")


if __name__ == "__main__":
    stage_a()
    stage_a5()
    stage_b()
    schematic()
