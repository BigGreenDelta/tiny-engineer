# Safety checklist

Go through it before the first power-up of each stage, and again after any rewiring.

## Every time

- [ ] **Power off while wiring.** USB out of the ESP32, charger out of the USB-C breakout, before you move a single wire or touch the iron to the board.
- [ ] **Electrolytic polarity.** The 1000 uF capacitor has a stripe of minus signs down one side: that leg is minus and goes to GND (brown). The longer leg is plus and goes to +5 V (red). Reversed, it can bulge, leak or pop. Stage A: stripe in row 22. Stage B: stripe in `O2`.
- [ ] **No short between +5 V and GND.** Meter on continuity, nothing powered: +5 V to GND must not beep (Stage A `a20` to `b22`, Stage B `R4` to `R2`).
- [ ] **Servo plugs the right way round.** Brown to GND. On the perfboard: brown to row 2, at the board edge. A servo plugged backwards gets 5 V on its ground wire.
- [ ] **One servo at a time.** Plug one, test it on the `Servo control` page, then add the next. If something is wrong, only one servo is at risk and you know which wire to look at.

## The two 5 V sources

- [ ] **Never feed the charger's 5 V into the ESP32's `VIN` pin while the ESP32's USB cable is connected.** Two 5 V supplies joined together push current into each other, and the PC's USB port is on the receiving end. In Stage B, `VIN` (`C24`) has no wire at all.
- [ ] **Grounds are joined, once.** Stage B: wire W3 from `C23` to the servo ground bus. Without it the servo signals have no reference and the servos jitter or do nothing.
- [ ] **The OLED gets 3.3 V, not 5 V.** Its pull-up resistors go to its VCC, so 5 V there would put 5 V on the ESP32's `D21` / `D22`.
- [ ] **Never power servos from `3V3`.** The ESP32's 3.3 V regulator is for the chip and the OLED.

## Stage A only

- [ ] One servo first, then a second one at most. Everything runs from the PC's USB port here.
- [ ] If the ESP32 restarts when the servos move (serial log: `Brownout detector was triggered`), stay with one servo and go to Stage B.

## Stage B only

- [ ] USB-C breakout pads checked with the meter before soldering: red probe on VBUS, black on GND, about +5 V.
- [ ] Rail voltage checked with the ESP32 and the servos unplugged: about 5 V between `R4` (+) and `R2` (-).
- [ ] Charger rated 5 V 3 A. A 1 A or 2 A phone charger may sag when all five servos centre at boot.

## While it runs

- Keep fingers out of the servo arms at power-up: the firmware moves every servo to its middle at boot.
- A servo that buzzes and gets warm while standing still is pushing against something. Unplug it, then free the mechanism or narrow its range in the setup wizard.
- A hot wire, a hot capacitor or a burning smell: pull the charger first, then the USB cable.
