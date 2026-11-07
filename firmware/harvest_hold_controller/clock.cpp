#include "clock.h"

#include <RTClib.h>
#include <esp_sntp.h>
#include <sys/time.h>

#include "config.h"
#include "shared.h"

namespace {
const uint32_t MIN_VALID = 1704067200;  // 2024-01-01: anything earlier means "not set"
RTC_DS3231 rtc;
bool rtcFound = false;
volatile bool ntpSynced = false;
uint32_t lastRtcWrite = 0;

void onNtpSync(struct timeval*) { ntpSynced = true; }

void setSystem(uint32_t unix) {
  struct timeval tv = {(time_t)unix, 0};
  settimeofday(&tv, nullptr);
}

void writeRtc(uint32_t unix) {
  if (!rtcFound) return;
  I2cGuard g;
  rtc.adjust(DateTime(unix));
  lastRtcWrite = millis();
}
}  // namespace

namespace clk {

bool valid() { return time(nullptr) > (time_t)MIN_VALID; }
uint32_t now() { return valid() ? (uint32_t)time(nullptr) : 0; }
uint32_t bootTime() { return valid() ? now() - millis() / 1000 : 0; }

void begin() {
  setenv("TZ", "UTC0", 1);  // all times are UTC; the app shows them in local time
  tzset();
  if (!HAS_DS3231) return;
  uint32_t t = 0;
  {
    I2cGuard g;
    rtcFound = rtc.begin(&Wire);
    if (rtcFound && !rtc.lostPower()) t = rtc.now().unixtime();
  }
  if (!rtcFound) Serial.println("DS3231 clock not found");
  if (t > MIN_VALID) {
    setSystem(t);
    Serial.printf("clock set from DS3231: %lu\n", (unsigned long)t);
  }
}

void set(uint32_t unix, const char* source) {
  if (unix < MIN_VALID) return;
  setSystem(unix);
  Serial.printf("clock set from %s: %lu\n", source, (unsigned long)unix);
  writeRtc(unix);
}

void startNtp() {
  static bool started = false;
  if (started) return;
  started = true;
  sntp_set_time_sync_notification_cb(onNtpSync);
  configTime(0, 0, NTP_SERVER);
}

void maintain() {
  // NTP corrects the system clock in the background; keep the DS3231 in step (at most hourly).
  if (ntpSynced && valid() && (lastRtcWrite == 0 || millis() - lastRtcWrite > 3600000UL)) {
    ntpSynced = false;
    writeRtc(now());
  }
}

}  // namespace clk
