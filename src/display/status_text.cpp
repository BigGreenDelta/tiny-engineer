#include "display/status_text.h"

#include <cstring>

namespace {

char g_text[kStatusTextMax + 1] = {0};
uint32_t g_setMs = 0;
uint32_t g_ttlMs = 0;

}  // namespace

void setStatusText(const char* text, uint32_t ttlMs, uint32_t nowMs) {
  if (text == nullptr || text[0] == '\0' || ttlMs == 0) {
    g_text[0] = '\0';
    return;
  }
  strncpy(g_text, text, kStatusTextMax);
  g_text[kStatusTextMax] = '\0';
  g_setMs = nowMs;
  g_ttlMs = ttlMs;
}

const char* statusText(uint32_t nowMs) {
  if (g_text[0] == '\0') {
    return nullptr;
  }
  if (nowMs - g_setMs >= g_ttlMs) {
    g_text[0] = '\0';
    return nullptr;
  }
  return g_text;
}
