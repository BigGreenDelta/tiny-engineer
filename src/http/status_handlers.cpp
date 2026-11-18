#include <Arduino.h>
#include <cstring>

#include "display/status_text.h"
#include "http/handlers.h"
#include "http/request.h"
#include "http/response.h"

// Status strip text (Tiny Engineer Broker). Body {"text":"...","ttl":300};
// empty text clears. Printable ASCII only, at most kStatusTextMax chars.
void handleStatusPost(WebServer& server) {
  JsonDocument body;

  if (!readJsonBody(server, body)) {
    return;
  }

  const JsonVariantConst text = body["text"];
  if (!text.is<const char*>()) {
    sendError(server, 400, "invalid text");
    return;
  }
  const char* s = text.as<const char*>();
  const size_t len = strlen(s);
  if (len > kStatusTextMax) {
    sendError(server, 400, "invalid text");
    return;
  }
  for (size_t i = 0; i < len; i++) {
    const unsigned char c = static_cast<unsigned char>(s[i]);
    if (c < 0x20 || c > 0x7E) {
      sendError(server, 400, "invalid text");
      return;
    }
  }

  uint32_t ttlS = kStatusTtlDefaultS;
  const JsonVariantConst ttl = body["ttl"];
  if (!ttl.isNull()) {
    if (!ttl.is<int>() || ttl.as<int>() < 1 || ttl.as<int>() > (int)kStatusTtlMaxS) {
      sendError(server, 400, "invalid ttl");
      return;
    }
    ttlS = (uint32_t)ttl.as<int>();
  }

  setStatusText(s, ttlS * 1000UL, millis());

  JsonDocument reply;
  reply["ok"] = true;
  reply["text"] = s;
  reply["ttl"] = len ? ttlS : 0;
  sendJson(server, 200, reply);
}
