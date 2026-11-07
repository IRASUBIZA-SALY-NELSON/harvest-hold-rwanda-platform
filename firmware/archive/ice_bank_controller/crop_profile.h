#pragma once
// The crop profile tells the controller what the stored crop needs.
// The backend picks the profile from the stock in the room and sends it to the device.
// The device keeps the last good profile in flash, so it keeps working without internet.

#include <ArduinoJson.h>
#include <Preferences.h>

struct CropProfile {
  char crop[24];
  uint16_t version;
  float targetC;          // chamber air temperature to hold
  float hysteresisC;      // cooling starts above target + h, stops below target - h
  float alarmHighC;       // alert when warmer than this for alarmGraceMin
  float alarmLowC;        // alert when colder than this
  float freezeGuardC;     // stop all cooling below this, whatever happens
  float rhLow;            // humidifier on below this %
  float rhHigh;           // humidifier off above this %
  uint16_t alarmGraceMin;
};

// Built-in default: CARROT (topped, washed). Used until the backend sends a profile.
// Sources: USDA Agriculture Handbook 66 (carrot: 0°C, 98-100% RH, freezes at about -1.4°C).
// The target is above 0°C because an ice-bank chamber cannot safely hold 0°C without risking
// freezing at the coil. The freeze guard and low alarm watch the air leaving the coil.
static const CropProfile CARROT_DEFAULT = {
  "carrot", 2,
  /* targetC */ 2.0f, /* hysteresisC */ 0.7f,
  /* alarmHighC */ 5.0f, /* alarmLowC */ 0.5f, /* freezeGuardC */ 0.0f,
  /* rhLow */ 92.0f, /* rhHigh */ 97.0f,
  /* alarmGraceMin */ 30,
};

// Reject profiles that would damage crops or equipment, whatever the backend sends.
inline bool profileIsSafe(const CropProfile& p) {
  return p.targetC >= -0.5f && p.targetC <= 15.0f &&
         p.hysteresisC >= 0.2f && p.hysteresisC <= 3.0f &&
         p.freezeGuardC >= -1.0f && p.freezeGuardC < p.targetC - p.hysteresisC &&
         p.alarmLowC < p.targetC && p.alarmHighC > p.targetC &&
         p.rhLow >= 50.0f && p.rhHigh <= 100.0f && p.rhLow < p.rhHigh &&
         p.alarmGraceMin <= 240;
}

// Expected JSON (the "controller" block of crop-profiles/<crop>.json, plus crop and version):
// {"crop":"carrot","version":3,"targetC":2,"hysteresisC":0.7,"alarmHighC":5,"alarmLowC":0,
//  "freezeGuardC":0,"rhLow":92,"rhHigh":97,"alarmGraceMin":30}
inline bool profileFromJson(const char* json, CropProfile& out) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  CropProfile p = CARROT_DEFAULT;
  strlcpy(p.crop, doc["crop"] | "unknown", sizeof(p.crop));
  p.version       = doc["version"] | 0;
  p.targetC       = doc["targetC"] | p.targetC;
  p.hysteresisC   = doc["hysteresisC"] | p.hysteresisC;
  p.alarmHighC    = doc["alarmHighC"] | p.alarmHighC;
  p.alarmLowC     = doc["alarmLowC"] | p.alarmLowC;
  p.freezeGuardC  = doc["freezeGuardC"] | p.freezeGuardC;
  p.rhLow         = doc["rhLow"] | p.rhLow;
  p.rhHigh        = doc["rhHigh"] | p.rhHigh;
  p.alarmGraceMin = doc["alarmGraceMin"] | p.alarmGraceMin;
  if (!profileIsSafe(p)) return false;
  out = p;
  return true;
}

inline void profileSave(const CropProfile& p) {
  Preferences prefs;
  prefs.begin("hh", false);
  prefs.putBytes("profile", &p, sizeof(p));
  prefs.end();
}

inline CropProfile profileLoad() {
  Preferences prefs;
  CropProfile p;
  prefs.begin("hh", true);
  size_t n = prefs.getBytes("profile", &p, sizeof(p));
  prefs.end();
  if (n != sizeof(p) || !profileIsSafe(p)) return CARROT_DEFAULT;
  return p;
}
