#pragma once
// One minute of cold room data, packed small so about a week fits in flash while offline.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <math.h>

enum RecordFlag : uint8_t {
  RF_SOLAR_CHARGING = 1 << 0,
  RF_PUMP = 1 << 1,
  RF_FAN = 1 << 2,
  RF_COMPRESSOR = 1 << 3,
  RF_HUMIDIFIER = 1 << 4,
  RF_DOOR_OPEN = 1 << 5,
  RF_RELATIVE_TIME = 1 << 6,  // `time` is seconds since boot: the clock was not set yet
};

static const int16_t NO_TEMP = INT16_MIN;
static const uint8_t NO_PERCENT = 255;
static const uint16_t NO_VOLTS = 0xFFFF;

struct __attribute__((packed)) Record {
  uint32_t time;  // UTC unix seconds, or seconds since boot with RF_RELATIVE_TIME
  uint16_t boot;  // boot number: a relative time only means something within the same boot
  int16_t chamber, coilOutlet, product, iceBank, outside;  // °C x 10
  uint8_t humidity, battery;                               // %
  uint16_t batteryCv, solarCv;                             // volts x 100
  uint8_t flags;
  uint8_t alerts;  // bit per alert, see ALERT_CODE in the main sketch
  uint16_t profileVersion;
};
static_assert(sizeof(Record) == 26, "Record layout changed: stored readings would be misread");

inline int16_t packTemp(float c) { return isnan(c) ? NO_TEMP : (int16_t)lroundf(constrain(c, -300.0f, 300.0f) * 10); }
inline uint8_t packPercent(float v) { return isnan(v) ? NO_PERCENT : (uint8_t)lroundf(constrain(v, 0.0f, 100.0f)); }
inline uint16_t packVolts(float v) { return isnan(v) ? NO_VOLTS : (uint16_t)lroundf(constrain(v, 0.0f, 600.0f) * 100); }

inline void putTemp(JsonObject o, const char* key, int16_t v) {
  if (v == NO_TEMP) o[key] = nullptr;
  else o[key] = v / 10.0f;
}

/** The JSON the backend expects for one reading ("t" = UTC unix seconds). */
inline void recordToJson(const Record& r, JsonObject o, const char* const* alertCodes, int alertCount) {
  o["t"] = r.time;
  putTemp(o, "chamber", r.chamber);
  putTemp(o, "coilOutlet", r.coilOutlet);
  putTemp(o, "product", r.product);
  putTemp(o, "iceBank", r.iceBank);
  putTemp(o, "outside", r.outside);
  if (r.humidity == NO_PERCENT) o["humidity"] = nullptr; else o["humidity"] = r.humidity;
  if (r.battery == NO_PERCENT) o["battery"] = nullptr; else o["battery"] = r.battery;
  if (r.batteryCv == NO_VOLTS) o["batteryV"] = nullptr; else o["batteryV"] = r.batteryCv / 100.0f;
  if (r.solarCv == NO_VOLTS) o["solarV"] = nullptr; else o["solarV"] = r.solarCv / 100.0f;
  o["solarCharging"] = (r.flags & RF_SOLAR_CHARGING) != 0;
  o["pump"] = (r.flags & RF_PUMP) != 0;
  o["fan"] = (r.flags & RF_FAN) != 0;
  o["compressor"] = (r.flags & RF_COMPRESSOR) != 0;
  o["humidifier"] = (r.flags & RF_HUMIDIFIER) != 0;
  o["door"] = (r.flags & RF_DOOR_OPEN) ? "open" : "closed";
  o["profileVersion"] = r.profileVersion;
  JsonArray alerts = o["alerts"].to<JsonArray>();
  for (int i = 0; i < alertCount; i++)
    if (r.alerts & (1 << i)) alerts.add(alertCodes[i]);
}
