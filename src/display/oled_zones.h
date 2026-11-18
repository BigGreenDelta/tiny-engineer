#pragma once

#include <cstdint>

#include "pins.h"

// Two-zone layout for 64-row panels. On two-colour 0.96" modules the top
// 16 rows are yellow: titles go there in a rounded "thought" box, and the
// details go in the 48 rows below. 32-row panels keep the stock layout.
constexpr bool kOledTwoZone = OLED_HEIGHT >= 64;
constexpr int kOledBandRows = 16;
constexpr int kOledBodyTop = kOledBandRows;
constexpr int kOledBodyRows = OLED_HEIGHT - kOledBandRows;

// Title in the band. Up to 9 letters are 12 px capitals; longer titles use
// the small font. `shown` letters are drawn (all when negative); while some
// are missing a bar cursor follows the last one (big capitals only).
void drawThoughtBox(const char* text, int shown = -1);

// Same without the border (the status strip above the face): up to 10 big
// capitals, else up to 21 small letters.
void drawBandText(const char* text, int shown = -1);

// Sleep strip: z z z with a 12 px capital Z at index `bigAt` (0-2).
void drawBandZzz(int bigAt);

// True when `text` is wider than the band even in the small font.
bool bandTextScrolls(const char* text);

// Small-font text too wide for the band, scrolled sideways: holds at the
// start, slides left until the end shows, holds, starts over. `elapsedMs`
// counts from when this text first appeared.
void drawBandScroll(const char* text, uint32_t elapsedMs);

// One line centered on row `centerY`, as large as fits the width:
// 12x16, then 6x16, then 6x8 px per letter.
void drawBodyText(const char* text, int centerY);

// Body rows used by the system screens.
constexpr int kOledBodyCenterY = kOledBodyTop + kOledBodyRows / 2;  // a lone line
constexpr int kOledBodyTextY = kOledBodyTop + 14;  // line above a progress bar
constexpr int kOledBodyBarY = kOledBodyTop + 30;
constexpr int kOledBodyBarH = 12;

// Two-zone screen: title in the band, one body line, optional bar (total > 0).
void showZonedScreen(const char* title, const char* body, int step = 0, int total = 0);

// Progress bar across the body width.
void drawBodyBar(int y, int height, int step, int total);
