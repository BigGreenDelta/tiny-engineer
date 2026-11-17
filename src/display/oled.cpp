#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include "pins.h"
#include "display/eyes.h"
#include "display/oled.h"
#include "display/oled_internal.h"
#include "network/wifi_connect.h"
#include "settings/settings.h"

Adafruit_SSD1306 display(
  OLED_WIDTH,
  OLED_PANEL_HEIGHT,
  &Wire,
  -1
);

bool oledAvailable = false;

void setOledRotation(bool rotate180) {
  display.setRotation(rotate180 ? 2 : 0);

  if (OLED_PANEL_HEIGHT == OLED_HEIGHT) {
    return;
  }

  // Layout is OLED_HEIGHT rows at the top of the buffer (bottom when
  // rotated). Shift the panel start line so those rows sit centred.
  const int margin = (OLED_PANEL_HEIGHT - OLED_HEIGHT) / 2;
  const int startLine = rotate180
    ? (OLED_PANEL_HEIGHT - OLED_HEIGHT - margin)
    : (OLED_PANEL_HEIGHT - margin);
  display.ssd1306_command(SSD1306_SETSTARTLINE | (startLine % OLED_PANEL_HEIGHT));
}

namespace {

constexpr uint32_t kProvisionRotateMs = 3500;
constexpr uint32_t kStatusThenIdleHoldMs = 3000;

uint32_t lastProvisionRotateMs = 0;
uint8_t provisionStep = 0;

}  // namespace

void showProvisioningOled(
  const char* line1,
  const char* line2
) {
  stopEyes();
  wakeOled();
  lastProvisionRotateMs = 0;
  showOledText(line1, line2);
}

void updateProvisioningOled(uint32_t nowMs) {
  if (!oledAvailable || !wifiProvisioningMode()) {
    return;
  }

  wakeOled();

  if (lastProvisionRotateMs != 0 &&
      nowMs - lastProvisionRotateMs < kProvisionRotateMs) {
    return;
  }

  lastProvisionRotateMs = nowMs;
  provisionStep = static_cast<uint8_t>((provisionStep + 1) % 2);

  if (provisionStep == 0) {
    showOledText("Join this WiFi", wifiApSsid());
  } else {
    showOledText("Then open", wifiApIpText());
  }
}

void showOledText(
  const char* line1,
  const char* line2
) {
  if (!oledAvailable) {
    return;
  }

  display.clearDisplay();

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 4);
  display.println(line1);

  if (line2 != nullptr) {
    display.setCursor(0, 18);
    display.println(line2);
  }

  display.display();
}

void showIdleScreen() {
  startEyes();
}

void showBootIpThenIdle(const char* ip) {
  showBootIp(ip);
  delay(kStatusThenIdleHoldMs);
  showIdleScreen();
}

void showTextThenIdle(const char* line1, const char* line2) {
  stopEyes();
  showOledText(line1, line2);
  delay(kStatusThenIdleHoldMs);
  showIdleScreen();
}

void blankOled() {
  if (!oledAvailable) {
    return;
  }

  display.clearDisplay();
  display.display();
}

void sleepOled() {
  if (!oledAvailable) {
    return;
  }

  display.ssd1306_command(SSD1306_DISPLAYOFF);
}

void wakeOled() {
  if (!oledAvailable) {
    return;
  }

  display.ssd1306_command(SSD1306_DISPLAYON);
}

void applyOledRotation() {
  if (!oledAvailable) {
    return;
  }

  setOledRotation(settingsOledRotate180());
}

void showOledOrientationTest(bool rotate180) {
  if (!oledAvailable) {
    return;
  }

  stopEyes();
  wakeOled();
  setOledRotation(rotate180);
  showOledText("THIS WAY UP");
}

void restoreProvisioningOled() {
  if (!wifiProvisioningMode()) {
    return;
  }

  applyOledRotation();
  showProvisioningOled("Join this WiFi", wifiApSsid());
}
