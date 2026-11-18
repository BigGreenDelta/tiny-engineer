#pragma once

#include <cstddef>
#include <cstdint>

// Text for the status strip above the face, set over HTTP (POST /status) by
// the Tiny Engineer Broker. While set it replaces the animation name; it
// clears itself after its TTL so a dead broker never leaves stale text.
// 21 small letters fit the 128 px strip; longer text scrolls sideways.
constexpr size_t kStatusTextMax = 48;
constexpr uint32_t kStatusTtlDefaultS = 300;
constexpr uint32_t kStatusTtlMaxS = 3600;

// Empty text clears. Text longer than kStatusTextMax is cut.
void setStatusText(const char* text, uint32_t ttlMs, uint32_t nowMs);

// Current text, or nullptr when unset or expired.
const char* statusText(uint32_t nowMs);
