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

// Band text with or without the rounded border; without it the band fits
// one more big capital and four more small letters.
void drawBand(const char* text, int shown, bool bordered) {
  if (text == nullptr) {
    return;
  }

  const int n = (int)strlen(text);
  shown = shown < 0 || shown > n ? n : shown;
  const int bigW = n > 0 ? n * (kBigGlyphW + kBigLetterGap) - kBigLetterGap : 0;
  const int padX = bordered ? kBoxPadX : 0;

  if (bigW + 2 * padX <= OLED_WIDTH) {
    if (bordered) {
      drawBox(bigW);
    }
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
  if (bordered) {
    drawBox(smallW);
  }
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);
  display.setCursor((OLED_WIDTH - smallW) / 2, (kOledBandRows - 8) / 2);
  for (int i = 0; i < shown; i++) {
    display.write((uint8_t)text[i]);
  }
}

}  // namespace

void drawThoughtBox(const char* text, int shown) {
  drawBand(text, shown, true);
}

void drawBandText(const char* text, int shown) {
  drawBand(text, shown, false);
}

namespace {
constexpr uint32_t kScrollHoldMs = 1500;
constexpr uint32_t kScrollMsPerPx = 25;  // 40 px/s
}  // namespace

bool bandTextScrolls(const char* text) {
  return text != nullptr && (int)strlen(text) * kSmallGlyphPitch - 1 > OLED_WIDTH;
}

void drawBandScroll(const char* text, uint32_t elapsedMs) {
  if (!bandTextScrolls(text)) {
    drawBandText(text);
    return;
  }
  const int width = (int)strlen(text) * kSmallGlyphPitch - 1;
  const int travel = width - OLED_WIDTH;
  const uint32_t moveMs = (uint32_t)travel * kScrollMsPerPx;
  const uint32_t t = elapsedMs % (kScrollHoldMs + moveMs + kScrollHoldMs);
  int offset = 0;
  if (t >= kScrollHoldMs + moveMs) {
    offset = travel;
  } else if (t >= kScrollHoldMs) {
    offset = (int)((t - kScrollHoldMs) / kScrollMsPerPx);
  }

  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);
  display.setCursor(-offset, (kOledBandRows - 8) / 2);
  for (const char* c = text; *c; c++) {
    display.write((uint8_t)*c);
  }
}

void drawBandZzz(int bigAt) {
  // One 12 px capital Z among small z's, bottoms on the same row.
  constexpr int kSmallW = 5;
  constexpr int kGap = 3;
  constexpr int kCount = 3;
  constexpr int kWidth = kBigGlyphW + (kCount - 1) * kSmallW + (kCount - 1) * kGap;
  constexpr int kBottom = kBigTextTop + kBigTextH;  // first row below the glyphs
  // The 5x7 font's z fills rows 2-6 of its cell.
  constexpr int kSmallTop = kBottom - 7;

  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(false);
  int x = (OLED_WIDTH - kWidth) / 2;
  for (int i = 0; i < kCount; i++) {
    if (i == bigAt) {
      drawBigChar(x, kBigTextTop, 'Z');
      x += kBigGlyphW + kGap;
    } else {
      display.drawChar(x, kSmallTop, 'z', SSD1306_WHITE, SSD1306_BLACK, 1);
      x += kSmallW + kGap;
    }
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
