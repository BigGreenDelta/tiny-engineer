#include "display/oled_zones.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <cctype>
#include <cstring>

#include "display/oled_internal.h"

namespace {

// 12 px capitals: the 5x7 font 2x wide, its 7 rows 2,2,1,2,1,2,2 px tall,
// so a 1 px border and a 1 px gap fit around them in 16 rows. Capitals
// only: descenders (g, p, q, y) need an 8th row.
constexpr uint8_t kBigRowHeights[7] = {2, 2, 1, 2, 1, 2, 2};
constexpr int kBigGlyphW = 10;
constexpr int kBigLetterGap = 2;
constexpr int kBigTextTop = 2;  // border row 0, gap row 1
constexpr int kBigTextH = 12;
constexpr int kSmallGlyphPitch = 6;
constexpr int kBoxPadX = 6;
constexpr int kBoxRadius = 5;
constexpr int kCursorW = 2;

void drawBigChar(int x, int y, char c) {
  static GFXcanvas1 glyph(6, 8);
  glyph.fillScreen(0);
  glyph.drawChar(0, 0, (unsigned char)toupper((unsigned char)c), 1, 0, 1);

  int py = y;
  for (int row = 0; row < 7; row++) {
    for (int col = 0; col < 5; col++) {
      if (glyph.getPixel(col, row)) {
        display.fillRect(x + col * 2, py, 2, kBigRowHeights[row], SSD1306_WHITE);
      }
    }
    py += kBigRowHeights[row];
  }
}

void drawBox(int textW) {
  int boxW = textW + 2 * kBoxPadX;
  boxW = boxW > OLED_WIDTH ? OLED_WIDTH : boxW;
  display.drawRoundRect((OLED_WIDTH - boxW) / 2, 0, boxW, kOledBandRows, kBoxRadius, SSD1306_WHITE);
}

}  // namespace

void drawThoughtBox(const char* text, int shown) {
  if (text == nullptr) {
    return;
  }

  const int n = (int)strlen(text);
  shown = shown < 0 || shown > n ? n : shown;
  const int bigW = n > 0 ? n * (kBigGlyphW + kBigLetterGap) - kBigLetterGap : 0;

  if (bigW + 2 * kBoxPadX <= OLED_WIDTH) {
    drawBox(bigW);
    int x = (OLED_WIDTH - bigW) / 2;
    for (int i = 0; i < shown; i++) {
      drawBigChar(x, kBigTextTop, text[i]);
      x += kBigGlyphW + kBigLetterGap;
    }
    if (shown < n) {
      display.fillRect(x, kBigTextTop, kCursorW, kBigTextH, SSD1306_WHITE);
    }
    return;
  }

  // Small font, 8 rows centered in the band.
  const int smallW = n * kSmallGlyphPitch - 1;
  drawBox(smallW);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);
  display.setCursor((OLED_WIDTH - smallW) / 2, (kOledBandRows - 8) / 2);
  for (int i = 0; i < shown; i++) {
    display.write((uint8_t)text[i]);
  }
}

void drawBodyText(const char* text, int centerY) {
  if (text == nullptr) {
    return;
  }

  const int n = (int)strlen(text);
  uint8_t sx = 2;
  uint8_t sy = 2;
  if (n * 6 * sx > OLED_WIDTH) {
    sx = 1;
  }
  if (n * 6 * sx > OLED_WIDTH) {
    sy = 1;
  }

  const int w = n * 6 * sx - sx;
  const int h = 7 * sy;  // cap height; descenders hang below
  display.setTextSize(sx, sy);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);
  display.setCursor(w < OLED_WIDTH ? (OLED_WIDTH - w) / 2 : 0, centerY - h / 2);
  display.print(text);
  display.setTextSize(1);
}

void showZonedScreen(const char* title, const char* body, int step, int total) {
  display.clearDisplay();
  drawThoughtBox(title);
  if (total > 0) {
    drawBodyText(body, kOledBodyTextY);
    drawBodyBar(kOledBodyBarY, kOledBodyBarH, step, total);
  } else {
    drawBodyText(body, kOledBodyCenterY);
  }
  display.display();
}

void drawBodyBar(int y, int height, int step, int total) {
  constexpr int kMarginX = 8;
  const int w = OLED_WIDTH - 2 * kMarginX;
  display.drawRoundRect(kMarginX, y, w, height, 3, SSD1306_WHITE);
  if (total <= 0 || step <= 0) {
    return;
  }
  step = step > total ? total : step;
  const int fill = (w - 4) * step / total;
  if (fill > 0) {
    display.fillRect(kMarginX + 2, y + 2, fill, height - 4, SSD1306_WHITE);
  }
}
