#pragma once
// UTC time for timestamping readings. Sources, best first: NTP over Wi-Fi, NTP / network time
// over 4G, and the battery-backed DS3231, which keeps the time through power cuts and offline days.

#include <Arduino.h>

namespace clk {
void begin();                                // reads the DS3231 (call after Wire.begin)
bool valid();                                // the time looks real
uint32_t now();                              // UTC unix seconds, 0 while unknown
uint32_t bootTime();                         // UTC unix time when the controller started, 0 while unknown
void set(uint32_t unix, const char* source);
void startNtp();                             // Wi-Fi: keeps the clock right in the background
void maintain();                             // network task: copies network time into the DS3231
}  // namespace clk
