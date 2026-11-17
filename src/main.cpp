#include <Arduino.h>
#include <Wire.h>
#include <ESP_I2S.h>

#include "pins.h"
#include "firmware_version.h"
#include "hardware/rgb.h"
#include "hardware/chip_temp.h"
#include "display/oled.h"
#include "audio/audio.h"
#include "animation.h"
#include "animation/constants.h"
#include "animation/util.h"
#include "hardware/pca9685_servos.h"
#include "hardware/servo_wrapper.h"
#include "network/wifi_connect.h"
#include "network/ota.h"
#include "extensions/push_button.h"
#include "http/server.h"
#include "settings/settings.h"
#include "serial/link.h"
#include "serial_log.h"
#include "sleep.h"
#include "robot_tick.h"
#include "boot/boot_loading.h"

namespace {

// A reset in the middle of an I2C transfer (flashing, the reset button)
// can leave a device holding SDA low while it waits for more clock pulses,
// and then nothing answers at boot. Clock it out and send a STOP.
void recoverI2cBus() {
  pinMode(I2C_SDA, INPUT_PULLUP);
  pinMode(I2C_SCL, OUTPUT_OPEN_DRAIN);
  digitalWrite(I2C_SCL, HIGH);
  delayMicroseconds(5);

  for (int i = 0; i < 9 && digitalRead(I2C_SDA) == LOW; i++) {
    digitalWrite(I2C_SCL, LOW);
    delayMicroseconds(5);
    digitalWrite(I2C_SCL, HIGH);
    delayMicroseconds(5);
  }

  // STOP: SDA rises while SCL is high.
  pinMode(I2C_SDA, OUTPUT_OPEN_DRAIN);
  digitalWrite(I2C_SDA, LOW);
  delayMicroseconds(5);
  digitalWrite(I2C_SCL, HIGH);
  delayMicroseconds(5);
  digitalWrite(I2C_SDA, HIGH);
  delayMicroseconds(5);
}

constexpr int kBootSteps = 6;

}  // namespace

void setup() {
  initServoOutputPin();

  // HWCDC defaults RX/TX to 256; stream DATA frames are ~1 KB COBS and overrun
  // the queue before serialLinkPoll drains → silent credit timeout on play.
  Serial.setRxBufferSize(4096);
  Serial.setTxBufferSize(4096);
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);  // HWCDC only; UART Serial has no such call
#endif
  serialLinkWatchUsb();
  delay(1000);

  initSettings();
  pushButtonApplyFromSettings();

  initChipTemp();

  serialLogPrintln();
  serialLogPrintln("==========================");
  serialLogPrintln("TINY ENGINEER");
  serialLogPrintln(FW_VERSION);
  serialLogPrintln("==========================");

  setRgb(0, 32, 0);

  serialLogPrintln();
  serialLogPrintln("Starting I2C");
  serialLogPrint("SDA = GP");
  serialLogPrintln(I2C_SDA);
  serialLogPrint("SCL = GP");
  serialLogPrintln(I2C_SCL);

  recoverI2cBus();
  Wire.begin(
    I2C_SDA,
    I2C_SCL
  );

  delay(100);

  initPca9685();

  initOled();

  const bool sleepServos = bootSleepInertiaUsesServos();

  if (bootLoadingIsProgress()) {
    bootShowProgress(1, kBootSteps, "Display");
  } else {
    bootBeginSleepingFace();
  }

  if (sleepServos) {
    bootSnapSleepPose();
  }

  bootShowProgress(2, kBootSteps, "WiFi...");
  runWifiSetup();
  bootShowProgress(
    2,
    kBootSteps,
    wifiConnected() ? "WiFi OK" :
    wifiProvisioningMode() ? "WiFi setup" : "WiFi failed"
  );

  bootShowProgress(3, kBootSteps, "Servos");

  serialLogPrintln();
  serialLogPrintln(
    "Starting MAX98357A"
  );

  I2S.setPins(
    I2S_BCLK,
    I2S_LRC,
    I2S_DIN
  );

  if (!I2S.begin(
        I2S_MODE_STD,
        SAMPLE_RATE,
        I2S_DATA_BIT_WIDTH_16BIT,
        I2S_SLOT_MODE_STEREO
      )) {
    serialLogPrintln(
      "ERROR: I2S initialization failed"
    );

    showOledText(
      "I2S ERROR",
      "Init failed"
    );

    haltWithRgbCode(RGB_CODE_I2S, "I2S / MAX98357A init failed");
  }

  serialLogPrintln("I2S OK");
  bootShowProgress(4, kBootSteps, "Audio");

  initAudioStorage();
  bootShowProgress(5, kBootSteps, "Storage");

  if (!sleepServos) {
    serialLogPrintln("Centering servos");
    centerAllServos();
  }

  if (bootLoadingIsProgress()) {
    bootShowProgress(kBootSteps, kBootSteps, "Ready");
    if (wifiProvisioningMode()) {
      showProvisioningOled("Join this WiFi", wifiApSsid());
    } else {
      showBootIpThenIdle(wifiConnected() ? wifiIpText() : "");
    }
  } else {
    bootRunSleepInertia();
    if (wifiProvisioningMode()) {
      showProvisioningOled("Join this WiFi", wifiApSsid());
    }
  }

  serialLogPrintln();
  serialLogPrintln("==========================");
  serialLogPrintln("ROBOT READY");
  serialLogPrintln("==========================");

  if (wifiConnected() && settingsWelcomeEnabled()) {
    setAnimation(AnimationId::Welcome);
  } else if (wifiConnected() && !settingsWelcomeEnabled()) {
    anim::parkHands(anim::TRANSITION_HAND_SPEED_DEG_S);
    setRgbForAnimation(AnimationId::None, millis());
  } else if (wifiProvisioningMode()) {
    setRgb(0, 0, 64);
  } else {
    setRgbForAnimation(AnimationId::None, millis());
  }

  // Wi-Fi mode (or setup AP) starts HTTP; USB-only skips it.
  if (wifiConnected() || wifiProvisioningMode()) {
    startHttpServer();
  }

  if (wifiConnected()) {
    startOta();
  }
  initSleep();
}

void loop() {
  serialLinkPoll();
  pushButtonPoll();
  pollHttpServer();
  pollOta();
  tickRobot();
}
