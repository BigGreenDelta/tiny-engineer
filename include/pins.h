#pragma once

#include <cstdint>

// =====================================================
// PINOUT
// =====================================================

#if defined(TE_BOARD_ESP32DEV)

// Classic ESP32 DevKit V1 (ELEGOO kit board), env:esp32dev.
// Avoids strapping pins 0/2/5/12/15, flash pins 6-11, input-only 34-39.

// I2C -> OLED
constexpr int I2C_SDA = 21;
constexpr int I2C_SCL = 22;

// I2S -> MAX98357A (not fitted; pins reserved)
constexpr int I2S_BCLK = 26;
constexpr int I2S_LRC  = 25;
constexpr int I2S_DIN  = 27;

constexpr int PUSH_BUTTON_PIN_DEFAULT = 0;  // the on-board BOOT button

// No WS2812 on this board (GPIO10 here is a flash pin: never drive it).
// A plain common-cathode RGB LED instead, one PWM pin per leg through a
// 220 ohm resistor: red D4 (4, as in kit lesson 2.2), green RX2 (16), blue
// TX2 (17). Listed in wire-byte order for the default rgb_order GRB, so the
// setup wizard's order fix still works when legs are swapped.
constexpr bool RGB_LED_PRESENT = false;
constexpr int RGB_LED_PIN = -1;
constexpr bool RGB_LED_DISCRETE = true;
constexpr int RGB_LED_PINS[3] = {16, 4, 17};

// No PCA9685: servos run on LEDC, one GPIO per servo channel.
constexpr bool PCA9685_OE_WIRED = false;
constexpr int PCA9685_OE_PIN = -1;
constexpr int SERVO_GPIO[5] = {
  18,  // HEAD
  19,  // NECK
  23,  // HAND_LEFT
  32,  // HAND_RIGHT
  33,  // BODY
};

#else

// I2C -> PCA9685 + OLED
constexpr int I2C_SDA = 0;   // GP0
constexpr int I2C_SCL = 1;   // GP1

// I2S -> MAX98357A
constexpr int I2S_BCLK = 2;  // GP2
constexpr int I2S_LRC  = 3;  // GP3
constexpr int I2S_DIN  = 4;  // GP4

// Default Extension-port GPIO for the push-button extension (settings `push_button_pin`).
constexpr int PUSH_BUTTON_PIN_DEFAULT = 20;  // GP20

// Built-in WS2812 RGB
constexpr bool RGB_LED_PRESENT = true;
constexpr int RGB_LED_PIN = 10;
constexpr bool RGB_LED_DISCRETE = false;
constexpr int RGB_LED_PINS[3] = {-1, -1, -1};

// PCA9685 output enable (active LOW). GP5 → OE; default on.
// Set PCA9685_OE_WIRED false only if OE is hard-tied off-chip (e.g. to GND).
constexpr bool PCA9685_OE_WIRED = true;
constexpr int PCA9685_OE_PIN = 5;

#endif

// =====================================================
// AUDIO
// =====================================================

// assets/ ships 44100 Hz WAVs; scripts/audio_pack.py halves them while packing LittleFS.
constexpr int SAMPLE_RATE = 22050;

// =====================================================
// PCA9685 / SERVOS
// =====================================================

constexpr uint8_t PCA9685_ADDRESS = 0x40;

constexpr int SERVO_STEP_MS = 10;

// Boot centering / sleep-pose rate (deg/s)
constexpr float SERVO_BOOT_SPEED_DEG_S = 35.0f;

// Servo pulse range
constexpr int SERVO_MIN_US = 800;
constexpr int SERVO_MAX_US = 2200;

// =====================================================
// OLED
// =====================================================

constexpr int OLED_WIDTH  = 128;
#if defined(TE_BOARD_ESP32DEV)
constexpr int OLED_HEIGHT = 64;  // 0.96" 128x64 panel
#else
constexpr int OLED_HEIGHT = 32;
#endif
constexpr uint8_t OLED_ADDRESS = 0x3C;
