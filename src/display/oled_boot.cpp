#include <Arduino.h>
#include <Adafruit_SSD1306.h>
#include <cstdio>
#include <cstring>

#include "pins.h"
#include "display/oled.h"
#include "display/oled_internal.h"
#include "display/oled_zones.h"

namespace {

void drawProgressBar(
  int x,
  int y,
  int width,
  int height,
  int step,
  int totalSteps
) {
  display.drawRect(
    x,
    y,
    width,
    height,
    SSD1306_WHITE
  );

  if (totalSteps <= 0 || step <= 0) {
    return;
  }

  const int progressWidth =
    (width - 2) * step / totalSteps;

  display.fillRect(
    x + 1,
    y + 1,
    progressWidth,
    height - 2,
    SSD1306_WHITE
  );
}

}  // namespace

void showBootProgress(
  int step,
  int totalSteps,
  const char* label
) {
  if (!oledAvailable) {
    return;
  }

  if (kOledTwoZone) {
    showZonedScreen("TINY ENGINEER", label, step, totalSteps);
    return;
  }

  display.clearDisplay();

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println("TINY ENGINEER");

  display.setCursor(0, 11);
  display.print(label);

  display.setCursor(96, 11);
  display.print(step);
  display.print("/");
  display.print(totalSteps);

  drawProgressBar(
    0,
    22,
    OLED_WIDTH,
    9,
    step,
    totalSteps
  );

  display.display();
}

void showBootIp(const char* ip) {
  if (!oledAvailable) {
    return;
  }

  const char* text =
    (ip != nullptr && ip[0] != '\0') ? ip : "No IP";

  if (kOledTwoZone) {
    showZonedScreen("ADDRESS", text);
    return;
  }

  const size_t len = strlen(text);

  // Default GFX glyph is 6×8 at size 1. Pick largest integer size that
  // keeps the whole IP on one line within OLED_WIDTH.
  int textSize = 2;
  int charW = 6 * textSize;

  while (textSize > 1 &&
         static_cast<int>(len) * charW > OLED_WIDTH) {
    textSize--;
    charW = 6 * textSize;
  }

  const int textH = 8 * textSize;
  const int textPx = static_cast<int>(len) * charW;
  int x = (OLED_WIDTH - textPx) / 2;
  int y = (OLED_HEIGHT - textH) / 2;

  if (x < 0) {
    x = 0;
  }

  if (y < 0) {
    y = 0;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(textSize);
  display.setTextWrap(false);
  display.setCursor(x, y);
  display.print(text);
  display.display();
}

void showServoProgress(
  int step,
  int totalSteps,
  const char* action
) {
  if (!oledAvailable) {
    return;
  }

  if (kOledTwoZone) {
    char line[32];
    snprintf(line, sizeof(line), "%d/%d %s", step, totalSteps, action != nullptr ? action : "");
    showZonedScreen("SERVO TEST", line, step, totalSteps);
    return;
  }

  display.clearDisplay();

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println("SERVO TEST x5");

  display.setCursor(0, 11);

  display.print(step);
  display.print("/");
  display.print(totalSteps);
  display.print(" ");

  display.println(action);

  drawProgressBar(
    0,
    23,
    OLED_WIDTH,
    9,
    step,
    totalSteps
  );

  display.display();
}

void showServoTestFinished() {
  if (!oledAvailable) {
    return;
  }

  if (kOledTwoZone) {
    showZonedScreen("SERVO TEST", "5 SERVOS OK");
    return;
  }

  display.clearDisplay();

  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 2);
  display.println("5 SERVOS");

  display.setTextSize(2);
  display.setCursor(42, 14);
  display.println("OK");

  display.display();
}
