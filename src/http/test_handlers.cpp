#include <Arduino.h>
#include <cstring>

#include "animation.h"
#include "api/commands.h"
#include "display/oled.h"
#include "hardware/rgb.h"
#include "http/handlers.h"
#include "http/request.h"
#include "http/response.h"

namespace {

JsonDocument testReply(const char* test) {
  JsonDocument reply;
  reply["ok"] = true;
  reply["test"] = test;
  return reply;
}

void finishTest(WebServer& server, const JsonDocument& reply) {
  showIdleScreen();
  sendJson(server, 200, reply);
}

void runNamedTest(WebServer& server, const char* name) {
  const ApiResult result = apiRunHardwareTest(name);
  if (!result.ok) {
    showIdleScreen();
    sendError(server, result.code, result.error);
    return;
  }
  finishTest(server, testReply(name));
}

}  // namespace

void handleAudioTest(WebServer& server) {
  runNamedTest(server, "audio");
}

void handleBellTest(WebServer& server) {
  runNamedTest(server, "bell");
}

void handleScreenTest(WebServer& server) {
  runNamedTest(server, "screen");
}

void handleMovementTest(WebServer& server) {
  runNamedTest(server, "movement");
}

void handleLedTest(WebServer& server) {
  runNamedTest(server, "led");
}

void handleServoTest(WebServer& server) {
  JsonDocument request;

  if (!readJsonBody(server, request)) {
    return;
  }

  const std::optional<ServoMove> move = ServoMove::read(server, request.as<JsonObjectConst>());

  if (!move) {
    return;
  }

  const ApiResult result = apiMoveServo(move->index, move->angle);
  if (!result.ok) {
    showIdleScreen();
    sendError(server, result.code, result.error);
    return;
  }

  JsonDocument reply = testReply("servo");
  move->addTo(reply);
  finishTest(server, reply);
}

void handleServosPark(WebServer& server) {
  const ApiResult result = apiParkServos();
  if (!result.ok) {
    sendError(server, result.code, result.error);
    return;
  }

  JsonDocument reply;
  reply["ok"] = true;
  reply["park"] = "servos";
  reply["hold"] = true;
  sendJson(server, 200, reply);
}

// Debug: hold any LED colour until released. Body {"r":0-255,"g":..,"b":..}
// holds it (animations stop changing the LED); {"release":true} hands the
// LED back to the current animation.
void handleRgbTest(WebServer& server) {
  JsonDocument body;

  if (!readJsonBody(server, body)) {
    return;
  }

  if (body["release"] == true) {
    rgbSetupRelease();
    setRgbForAnimation(getAnimation(), millis());
    JsonDocument reply = testReply("rgb");
    reply["release"] = true;
    sendJson(server, 200, reply);
    return;
  }

  uint8_t rgb[3] = {};
  const char* const names[3] = {"r", "g", "b"};
  for (int i = 0; i < 3; i++) {
    const JsonVariantConst v = body[names[i]];
    if (!v.is<int>() || v.as<int>() < 0 || v.as<int>() > 255) {
      sendError(server, 400, (String("invalid ") + names[i]).c_str());
      return;
    }
    rgb[i] = (uint8_t)v.as<int>();
  }

  rgbSetupHoldLogical(rgb[0], rgb[1], rgb[2], nullptr);

  JsonDocument reply = testReply("rgb");
  reply["r"] = rgb[0];
  reply["g"] = rgb[1];
  reply["b"] = rgb[2];
  sendJson(server, 200, reply);
}

// Debug: show a title and one line of text for 3 s, then the eyes again.
// Body {"title":"...","text":"..."}; text is optional.
void handleOledTest(WebServer& server) {
  constexpr size_t kMaxTitle = 21;
  constexpr size_t kMaxText = 21;
  JsonDocument body;

  if (!readJsonBody(server, body)) {
    return;
  }

  const JsonVariantConst title = body["title"];
  const JsonVariantConst text = body["text"];
  if (!title.is<const char*>() || strlen(title.as<const char*>()) == 0 ||
      strlen(title.as<const char*>()) > kMaxTitle) {
    sendError(server, 400, "invalid title");
    return;
  }
  if (!text.isNull() && (!text.is<const char*>() || strlen(text.as<const char*>()) > kMaxText)) {
    sendError(server, 400, "invalid text");
    return;
  }

  showTextThenIdle(title.as<const char*>(), text.isNull() ? nullptr : text.as<const char*>());

  JsonDocument reply = testReply("oled");
  reply["title"] = title;
  if (!text.isNull()) {
    reply["text"] = text;
  }
  sendJson(server, 200, reply);
}
