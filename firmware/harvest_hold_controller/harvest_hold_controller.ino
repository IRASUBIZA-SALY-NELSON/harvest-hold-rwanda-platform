// =====================================================================================
//  Harvest Hold Rwanda: cold room controller (ESP32), Peltier prototype
//
//  Solar panel -> battery -> Peltier module(s) cool the chamber. The cold-side fan blows chamber
//  air over the cold heatsink; the hot-side fan carries the heat out. The cooler's power is set
//  smoothly (PWM) by a PI controller, within limits that protect the module, the crop and the battery.
//  (The ice-bank version for scale-up is in ../archive/ice_bank_controller.)
//
//  Two tasks:
//   - Control (this loop, core 1): sensors, relays, freeze guard, alerts. Never waits on the
//     network, so the freeze guard always reacts within one control cycle (2 s).
//   - Network (core 0): stores readings in flash, uploads them when online (Wi-Fi or 4G),
//     sends SMS, fetches the crop profile, keeps the clock right, installs firmware updates.
//
//  Libraries (Arduino Library Manager): OneWire, DallasTemperature, Adafruit SHT31 Library,
//  ArduinoJson (v7), LiquidCrystal I2C (Frank de Brabander), RTClib, TinyGSM, ArduinoHttpClient,
//  ESP_SSLClient, PubSubClient (Nick O'Leary). Board: ESP32 Dev Module, Partition scheme: Custom (partitions.csv).
// =====================================================================================

#include <Adafruit_SHT31.h>
#include <DallasTemperature.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <Preferences.h>
#include <Wire.h>
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>

#include "clock.h"
#include "config.h"
#include "crop_profile.h"
#include "net.h"
#include "power_meter.h"
#include "record.h"
#include "record_buffer.h"
#include "remote.h"
#include "shared.h"

// ---------------------------------------------------------------- shared with the network task

QueueHandle_t recordQueue, smsQueue, profileQueue, commandQueue, ackQueue;
volatile ControlSnapshot controlSnapshot = {};
SemaphoreHandle_t i2cLock;
volatile uint32_t networkHeartbeat = 0;
uint16_t bootCount = 0;

// ---------------------------------------------------------------- state

OneWire oneWire(PIN_ONEWIRE);
DallasTemperature ds(&oneWire);
Adafruit_SHT31 sht31;
LiquidCrystal_I2C lcd(LCD_I2C_ADDRESS, 16, 2);

CropProfile profile;

struct Readings {
  float chamberC = NAN;   // room air, used for control and alarms
  float coldAirC = NAN;   // air blown off the cold-side heatsink
  float coldestC = NAN;   // coldest of the two: used for the freeze guard
  float productC = NAN;   // probe inside the produce
  float hotSideC = NAN;   // hot-side heatsink
  float outsideC = NAN;
  float humidity = NAN;
  float batteryV = NAN;
  float solarV = NAN;
  float coolerA = NAN;    // Peltier current (power meter)
  float coolerV = NAN;    // Peltier supply voltage (power meter)
  float solarA = NAN;     // solar panel current (solar meter, optional)
  bool doorOpen = false;
  bool solarCharging = false;
} r;

struct Outputs {
  float coolerPower = 0;  // % PWM
  bool hotFan = false, innerFan = false, humidifier = false;
} out;

enum BatteryState { BATT_OK, BATT_SAVING, BATT_CRITICAL };
BatteryState battState = BATT_OK;

float integral = 0;  // the PI controller's memory, in % power
unsigned long lastCoolerOn = 0, humidifierOnAt = 0;
unsigned long doorOpenedAt = 0, lastCirculation = 0;
unsigned long lastControl = 0, lastRecord = 0;
unsigned long tooWarmSince = 0, tooColdSince = 0, fullPowerSince = 0, noCurrentSince = 0, weakSince = 0;
bool shtOk = false, meterOk = false, solarMeterOk = false;
bool firmwareConfirmed = false;

// ---------------------------------------------------------------- alerts

enum AlertId { AL_TOO_WARM, AL_TOO_COLD, AL_BATTERY_LOW, AL_HOT_SIDE, AL_COOLER_FAULT, AL_CAPACITY, AL_DOOR_OPEN, AL_SENSOR_FAIL, AL_COUNT };
const char* const ALERT_CODE[AL_COUNT] = {"chamber_warm", "chamber_cold", "battery_low", "hot_side_overheat",
                                          "cooler_fault", "cooling_capacity", "door_open", "sensor_fail"};
static_assert(AL_COUNT <= 8, "alerts are stored as 8 bits in a Record");
bool alertActive[AL_COUNT] = {false};
unsigned long alertSentAt[AL_COUNT] = {0};

// After a firmware update the new version is on probation: if it crashes or hangs before
// confirmFirmware() runs, the bootloader goes back to the previous version.
bool verifyRollbackLater() { return true; }

// ---------------------------------------------------------------- remote overrides
// Timed, kept in RAM only: a restart returns the room to fully automatic control.

struct Overrides {
  float targetC = NAN;
  unsigned long targetUntil = 0, coolingOffUntil = 0, innerFanUntil = 0, hotFanUntil = 0, innerFanOffUntil = 0, hotFanOffUntil = 0;
} ovr;
bool localLock = false;

bool running(unsigned long until, unsigned long now) { return until != 0 && (long)(until - now) > 0; }
uint16_t minutesLeft(unsigned long until, unsigned long now) { return running(until, now) ? (uint16_t)((until - now + 59999UL) / 60000UL) : 0; }

/** The target the room is held at: a remote target while it lasts, else the crop profile's. */
float activeTarget(unsigned long now) { return running(ovr.targetUntil, now) && !isnan(ovr.targetC) ? ovr.targetC : profile.targetC; }

uint32_t recentCommands[8] = {0};
uint8_t recentNext = 0;
bool seenCommand(uint32_t id) {
  for (uint32_t v : recentCommands)
    if (v == id) return true;
  return false;
}

void sendAck(uint32_t id, bool ok, const char* message) {
  CommandAck a = {id, ok, {0}};
  strlcpy(a.message, message, sizeof a.message);
  if (xQueueSend(ackQueue, &a, 0) != pdTRUE) {  // full: the platform will ask again, the command is not repeated
    CommandAck dropped;
    xQueueReceive(ackQueue, &dropped, 0);
    xQueueSend(ackQueue, &a, 0);
  }
}

/** Carries out the commands the network task received. The controller checks every one again. */
void applyCommands(unsigned long now) {
  RemoteCommand c;
  while (xQueueReceive(commandQueue, &c, 0) == pdTRUE) {
    if (localLock) {  // someone at the room is in charge
      sendAck(c.id, false, "on-site control is on");
      continue;
    }
    if (seenCommand(c.id)) {  // arrived on both roads: already done, only answer again
      sendAck(c.id, true, "already carried out");
      continue;
    }
    bool ok = true;
    const char* why = "ok";
    unsigned long until = now + (unsigned long)c.minutes * 60000UL;
    switch (c.type) {
      case CMD_SET_TARGET: {
        if (c.backToAuto) {
          ovr.targetUntil = 0;
          break;
        }
        float lo = max(profile.alarmLowC + REMOTE_TARGET_MARGIN_C, profile.freezeGuardC + profile.hysteresisC + REMOTE_TARGET_MARGIN_C);
        float hi = profile.alarmHighC - REMOTE_TARGET_MARGIN_C;
        if (isnan(c.targetC) || c.targetC < lo || c.targetC > hi) { ok = false; why = "target outside the safe range"; }
        else if (c.minutes < 1 || c.minutes > REMOTE_MAX_TARGET_MIN) { ok = false; why = "bad duration"; }
        else { ovr.targetC = c.targetC; ovr.targetUntil = until; integral = 0; }
        break;
      }
      case CMD_COOLING:
        if (c.backToAuto) ovr.coolingOffUntil = 0;
        else if (c.minutes < 1 || c.minutes > REMOTE_MAX_COOLING_OFF) { ok = false; why = "bad duration"; }
        else ovr.coolingOffUntil = until;
        break;
      case CMD_INSIDE_FAN:
        if (c.backToAuto) ovr.innerFanUntil = ovr.innerFanOffUntil = 0;
        else if (c.minutes < 1 || c.minutes > REMOTE_MAX_FAN_ON) { ok = false; why = "bad duration"; }
        else if (c.off) { ovr.innerFanOffUntil = until; ovr.innerFanUntil = 0; why = "off while the cooler is not running"; }
        else { ovr.innerFanUntil = until; ovr.innerFanOffUntil = 0; }
        break;
      case CMD_HOT_FAN:
        if (c.backToAuto) ovr.hotFanUntil = ovr.hotFanOffUntil = 0;
        else if (c.minutes < 1 || c.minutes > REMOTE_MAX_FAN_ON) { ok = false; why = "bad duration"; }
        else if (c.off) { ovr.hotFanOffUntil = until; ovr.hotFanUntil = 0; why = "off while the cooler is stopped and the hot side is cool"; }
        else { ovr.hotFanUntil = until; ovr.hotFanOffUntil = 0; }
        break;
      default:
        ok = false;
        why = "unknown command";
    }
    if (ok) {
      recentCommands[recentNext++ % 8] = c.id;
      Serial.printf("remote command %u carried out\n", (unsigned)c.id);
    } else {
      Serial.printf("remote command %u refused: %s\n", (unsigned)c.id, why);
    }
    sendAck(c.id, ok, why);
  }
}

/** Overrides that must end early because the crop or the room needs the normal control back. */
void endUnsafeOverrides(unsigned long now) {
  // Cooling switched off remotely never lets the room get warm: past the alarm limit it resumes by itself.
  if (running(ovr.coolingOffUntil, now) && !isnan(r.chamberC) && r.chamberC >= profile.alarmHighC - 0.2f) {
    ovr.coolingOffUntil = 0;
    Serial.println("remote 'cooling off' ended: chamber reached the alarm limit");
  }
  if (isnan(r.chamberC) && running(ovr.coolingOffUntil, now)) ovr.coolingOffUntil = 0;  // blind: back to automatic
}

void publishControlSnapshot(unsigned long now) {
  controlSnapshot.targetC = activeTarget(now);
  controlSnapshot.targetMinutesLeft = minutesLeft(ovr.targetUntil, now);
  controlSnapshot.coolingOffMinutesLeft = minutesLeft(ovr.coolingOffUntil, now);
  controlSnapshot.insideFanMinutesLeft = minutesLeft(ovr.innerFanUntil, now);
  controlSnapshot.hotFanMinutesLeft = minutesLeft(ovr.hotFanUntil, now);
  controlSnapshot.insideFanOffMinutesLeft = minutesLeft(ovr.innerFanOffUntil, now);
  controlSnapshot.hotFanOffMinutesLeft = minutesLeft(ovr.hotFanOffUntil, now);
  controlSnapshot.localLock = localLock;
}

/** The on-site key switch: while it is on, remote overrides are cancelled and refused. */
void readLocalLock() {
  bool lock = HAS_LOCAL_LOCK && digitalRead(PIN_LOCAL_LOCK) == LOW;
  if (lock && !localLock) {
    ovr = Overrides();
    Serial.println("on-site control ON: remote overrides cancelled");
  }
  localLock = lock;
}

// ---------------------------------------------------------------- helpers

void setRelay(int pin, bool on) { digitalWrite(pin, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW); }

void setCoolerPwm(float percent) { ledcWrite(PIN_COOLER_PWM, (uint32_t)lroundf(constrain(percent, 0.0f, 100.0f) * 1023 / 100)); }

float readTemp(const uint8_t* addr) {
  float t = ds.getTempC(addr);
  // 85.0 is what a DS18B20 reports before its first conversion: never a real reading in the chamber.
  return (t == DEVICE_DISCONNECTED_C || t < -50 || t > 80 || t == 85.0f) ? NAN : t;
}

/** The hot side can really reach 85 °C and more when something fails: accept the sensor's full range. */
float readHotSide() {
  float t = ds.getTempC(ADDR_HOT_SIDE);
  return (t == DEVICE_DISCONNECTED_C || t < -50 || t > 125) ? NAN : t;
}

float readVoltage(int pin, float divider) {
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(pin);
  return (mv / 16.0f) / 1000.0f * divider;
}

float smooth(float prev, float now, float k = 0.2f) {
  if (isnan(now)) return prev;
  if (isnan(prev)) return now;
  return prev + k * (now - prev);
}

// Rough state of charge for a 12V AGM battery. Only accurate at rest, good enough for a display.
float batteryPercent(float v) {
  const float volts[] = {11.8f, 12.0f, 12.3f, 12.6f, 12.85f};
  const float pct[] = {0, 25, 50, 75, 100};
  if (isnan(v)) return NAN;
  if (v <= volts[0]) return 0;
  for (int i = 1; i < 5; i++) {
    if (v <= volts[i]) return pct[i - 1] + (v - volts[i - 1]) / (volts[i] - volts[i - 1]) * (pct[i] - pct[i - 1]);
  }
  return 100;
}

/** Queues an SMS for the network task. Never blocks: if the queue is full the message is dropped. */
void queueSms(const String& text) {
  SmsMessage m;
  strlcpy(m.text, text.c_str(), sizeof m.text);
  xQueueSend(smsQueue, &m, 0);
}

void updateAlert(AlertId id, bool condition, const String& message) {
  if (!condition) {
    alertActive[id] = false;
    return;
  }
  unsigned long now = millis();
  if (!alertActive[id] || now - alertSentAt[id] > ALERT_REPEAT_MS) {
    String text = String("Harvest Hold ") + DEVICE_ID + ": " + message;
    Serial.println("ALERT " + text);
    queueSms(text);
    alertSentAt[id] = now;
  }
  alertActive[id] = true;
}

// ---------------------------------------------------------------- sensors

void readSensors() {
  // Temperatures from the conversion started last cycle; then start the next one. No waiting.
  float air = readTemp(ADDR_CHAMBER_AIR);
  r.coldAirC = readTemp(ADDR_COLD_AIR);
  r.productC = readTemp(ADDR_PRODUCT);
  r.hotSideC = readHotSide();
  r.outsideC = readTemp(ADDR_OUTSIDE);
  ds.requestTemperatures();

  // Not smoothed: the freeze guard must react fast. Each sensor stands in for the other if one fails.
  r.chamberC = !isnan(air) ? air : r.coldAirC;
  r.coldestC = !isnan(r.coldAirC) && !isnan(air) ? min(air, r.coldAirC) : r.chamberC;

  if (shtOk) {
    float h, t;
    {
      I2cGuard g;
      h = sht31.readHumidity();
      t = sht31.readTemperature();
    }
    r.humidity = isnan(h) ? NAN : smooth(r.humidity, constrain(h, 0.0f, 100.0f));
    // The chamber DS18B20s are the main temperature; the SHT31 is a backup.
    if (isnan(r.chamberC)) r.chamberC = r.coldestC = t;
  }

  if (meterOk) {
    r.coolerA = smooth(r.coolerA, power::amps(), 0.5f);
    r.coolerV = smooth(r.coolerV, power::volts(), 0.5f);
  }

  if (solarMeterOk) r.solarA = smooth(r.solarA, solar::amps(), 0.5f);

  if (HAS_BATTERY) {
    r.batteryV = smooth(r.batteryV, readVoltage(PIN_BATTERY_ADC, BATTERY_DIVIDER));
    r.solarV = smooth(r.solarV, readVoltage(PIN_SOLAR_ADC, SOLAR_DIVIDER));
    r.solarCharging = r.solarV > r.batteryV + SOLAR_CHARGING_MARGIN_V;
  }

  bool open = digitalRead(PIN_DOOR_SWITCH) == HIGH;
  if (open && !r.doorOpen) doorOpenedAt = millis();
  r.doorOpen = open;
}

// ---------------------------------------------------------------- control

void updateBatteryState() {
  float v = r.batteryV;
  if (!HAS_BATTERY || isnan(v)) return;
  switch (battState) {
    case BATT_OK:       if (v < BATT_CRITICAL_V) battState = BATT_CRITICAL; else if (v < BATT_SAVING_V) battState = BATT_SAVING; break;
    case BATT_SAVING:   if (v < BATT_CRITICAL_V) battState = BATT_CRITICAL; else if (v > BATT_RECOVER_SAVING_V) battState = BATT_OK; break;
    case BATT_CRITICAL: if (v > BATT_RECOVER_V) battState = BATT_SAVING; break;
  }
}

/** Highest power allowed right now, whatever the controller wants. 0 = must be off now. */
float coolerLimit() {
  float cap = 100;
  // Hot side: reduce from the limit, cut at the cutoff. Without a hot-side sensor, run gently.
  float hot = r.hotSideC;
  if (isnan(hot)) cap = 40;
  else if (hot >= HOT_SIDE_CUTOFF_C) return 0;
  else if (hot > HOT_SIDE_LIMIT_C) cap = 100 * (HOT_SIDE_CUTOFF_C - hot) / (HOT_SIDE_CUTOFF_C - HOT_SIDE_LIMIT_C);
  // Freeze guard: the coldest air must stay above the crop's limit.
  if (!isnan(r.coldestC)) {
    if (r.coldestC < profile.freezeGuardC) return 0;
    if (r.coldestC < profile.freezeGuardC + 1.0f) cap = min(cap, out.coolerPower);  // close to it: no more power
  }
  // Frost on the cold heatsink blocks the air.
  if (!isnan(r.coldAirC) && r.coldAirC < COLD_SINK_FROST_C) cap = min(cap, 30.0f);
  // Door open: the inside fan stops, so the cold side cannot get rid of its cold.
  if (r.doorOpen) cap = min(cap, 30.0f);
  if (battState == BATT_SAVING) cap = min(cap, BATT_SAVING_POWER);
  if (battState == BATT_CRITICAL) return 0;
  return cap;
}

/** PI control of the Peltier power, every control cycle. */
void controlCooler(unsigned long now) {
  const float dtMin = CONTROL_INTERVAL_MS / 60000.0f;
  float want;
  if (isnan(r.chamberC)) {
    want = 50;  // no chamber reading: steady half power so the crop is not left warm (the guards still apply)
  } else {
    float err = r.chamberC - activeTarget(now);  // positive = too warm
    float p = COOLER_KP * err;
    // Anti-windup: stop adding up while the output is already at its end in that direction.
    bool pinnedHigh = p + integral >= 100 && err > 0;
    bool pinnedLow = p + integral <= 0 && err < 0;
    if (!pinnedHigh && !pinnedLow) integral = constrain(integral + COOLER_KI * err * dtMin, 0.0f, 100.0f);
    want = constrain(p + integral, 0.0f, 100.0f);
    if (err < -profile.hysteresisC) {  // clearly too cold: off, and forget the built-up demand
      want = 0;
      integral = 0;
    }
  }

  float cap = coolerLimit();
  // Cooling switched off remotely (timed): the limits above still apply, and nothing builds up meanwhile.
  if (running(ovr.coolingOffUntil, now)) {
    want = 0;
    integral = 0;
  }
  want = min(want, cap);
  // Very low power does more harm than good (heat leaks back): either a useful minimum or off.
  if (want > 0 && want < COOLER_MIN_POWER) want = (want >= COOLER_MIN_POWER / 2 && cap >= COOLER_MIN_POWER) ? COOLER_MIN_POWER : 0;

  // Change gently (thermal shock shortens the module's life), except when a limit says lower now.
  float next = out.coolerPower + constrain(want - out.coolerPower, -COOLER_MAX_STEP, COOLER_MAX_STEP);
  out.coolerPower = cap == 0 ? 0 : min(next, cap);
  if (out.coolerPower > 0) lastCoolerOn = now;

  // Hot-side fan: whenever the module runs, a while after, and whenever the heatsink is warm.
  out.hotFan = out.coolerPower > 0 || now - lastCoolerOn < HOT_FAN_RUN_ON_MS || (!isnan(r.hotSideC) && r.hotSideC > 40) || running(ovr.hotFanUntil, now);
  // Inside fan: with the cooler, plus a short stir every 15 min so the chamber stays even.
  bool stir = now - lastCirculation < CIRCULATION_FOR_MS;
  if (now - lastCirculation > CIRCULATION_EVERY_MS) lastCirculation = now;
  out.innerFan = (out.coolerPower > 0 || stir || running(ovr.innerFanUntil, now)) && !r.doorOpen && battState != BATT_CRITICAL;
  // Fans switched OFF remotely are honoured only when that is safe: the cold side needs its fan while the
  // cooler runs (or the coil frosts), and the hot side needs its fan until the heatsink is cool.
  if (running(ovr.innerFanOffUntil, now) && out.coolerPower == 0) out.innerFan = false;
  if (running(ovr.hotFanOffUntil, now) && out.coolerPower == 0 && !isnan(r.hotSideC) && r.hotSideC < 40) out.hotFan = false;
}

void controlHumidity(unsigned long now) {
  if (!HAS_HUMIDIFIER) return;
  bool allowed = !isnan(r.humidity) && !r.doorOpen && battState == BATT_OK && out.innerFan;
  bool want = out.humidifier;
  if (r.humidity < profile.rhLow) want = true;
  if (r.humidity > profile.rhHigh) want = false;
  if (!allowed) want = false;
  if (want && !out.humidifier) humidifierOnAt = now;
  if (want && now - humidifierOnAt > HUMIDIFIER_MAX_ON_MS) want = false;  // rest so crops never get wet
  out.humidifier = want;
}

/** Tracks how long a condition has lasted: returns true once it has lasted `forMs`. */
bool lasting(unsigned long& since, bool condition, unsigned long now, unsigned long forMs) {
  if (!condition) {
    since = 0;
    return false;
  }
  if (!since) since = now;
  return now - since >= forMs;
}

void checkAlerts(unsigned long now) {
  float t = r.chamberC;
  float cold = r.coldestC;

  bool warm = lasting(tooWarmSince, !isnan(t) && t > profile.alarmHighC, now, profile.alarmGraceMin * 60000UL);
  bool tooCold = lasting(tooColdSince, !isnan(cold) && cold < profile.alarmLowC, now, 600000UL);
  // Asked for power, but (almost) no current: dead module, blown fuse, broken wire or MOSFET.
  bool noCurrent = lasting(noCurrentSince, meterOk && out.coolerPower >= 50 && r.coolerA < FAULT_MIN_CURRENT_A, now, 120000UL);
  // Runs hard but the two sides are hardly different: the module is not pumping heat.
  bool weak = lasting(weakSince, out.coolerPower >= 60 && !isnan(r.hotSideC) && !isnan(r.coldAirC) && r.hotSideC - r.coldAirC < 5, now, 900000UL);
  bool atLimit = lasting(fullPowerSince, out.coolerPower >= 95 && !isnan(t) && t > activeTarget(now) + 1, now, CAPACITY_ALERT_MS);

  updateAlert(AL_TOO_WARM, warm, String("chamber too warm ") + String(t, 1) + "C");
  updateAlert(AL_TOO_COLD, tooCold, String("too cold near the cooler ") + String(cold, 1) + "C, crops may freeze");
  updateAlert(AL_BATTERY_LOW, HAS_BATTERY && battState != BATT_OK, String("battery low ") + String(r.batteryV, 1) + "V");
  updateAlert(AL_HOT_SIDE, !isnan(r.hotSideC) && r.hotSideC > HOT_SIDE_LIMIT_C,
              String("cooler hot side ") + String(r.hotSideC, 0) + "C: power reduced. Check the hot-side fan and heatsink");
  updateAlert(AL_COOLER_FAULT, noCurrent || weak, noCurrent ? "cooler gets no current: check fuse, wiring, MOSFET and module" : "cooler is not cooling: check the module and its heatsinks");
  updateAlert(AL_CAPACITY, atLimit, "cooler at full power for 1 h and still above target: check the door seal, the load and the heat outside");
  updateAlert(AL_DOOR_OPEN, r.doorOpen && now - doorOpenedAt > DOOR_ALERT_MS, "door open for more than 3 min");
  updateAlert(AL_SENSOR_FAIL, isnan(t) || isnan(r.hotSideC), "temperature sensor not responding");
}

void applyOutputs() {
  setCoolerPwm(out.coolerPower);
  setRelay(PIN_RELAY_HOT_FAN, out.hotFan);
  setRelay(PIN_RELAY_INNER_FAN, out.innerFan);
  if (HAS_HUMIDIFIER) setRelay(PIN_RELAY_HUMIDIFIER, out.humidifier);
  digitalWrite(PIN_STATUS_LED, net::link() != net::LINK_NONE);
}

/** A new crop profile from the backend (checked as safe by the network task). */
void applyNewProfile() {
  CropProfile p;
  if (xQueueReceive(profileQueue, &p, 0) != pdTRUE) return;
  if (p.version == profile.version && strcmp(p.crop, profile.crop) == 0) return;
  profile = p;
  profileSave(p);
  Serial.printf("new profile: %s v%u target %.1fC\n", p.crop, p.version, p.targetC);
}

/** Once a minute: hand a reading to the network task (stored in flash until uploaded). */
void recordReading(unsigned long now) {
  if (lastRecord && now - lastRecord < RECORD_INTERVAL_MS) return;
  lastRecord = now;
  Record rec = {};
  bool timed = clk::valid();
  rec.time = timed ? clk::now() : now / 1000;
  rec.boot = bootCount;
  rec.chamber = packTemp(r.chamberC);
  rec.coldAir = packTemp(r.coldAirC);
  rec.product = packTemp(r.productC);
  rec.hotSide = packTemp(r.hotSideC);
  rec.outside = packTemp(r.outsideC);
  rec.humidity = packPercent(r.humidity);
  rec.battery = packPercent(batteryPercent(r.batteryV));
  rec.batteryCv = packVolts(r.batteryV);
  rec.solarCv = packVolts(r.solarV);
  rec.coolerPower = (uint8_t)lroundf(out.coolerPower);
  rec.coolerCa = packAmps(r.coolerA);
  rec.coolerCv = packVolts(r.coolerV);
  rec.solarCa = solarMeterOk ? packAmps(r.solarA) : NO_VOLTS;
  rec.flags = (r.solarCharging ? RF_SOLAR_CHARGING : 0) | (out.hotFan ? RF_HOT_FAN : 0) | (out.innerFan ? RF_INNER_FAN : 0) |
              (out.humidifier ? RF_HUMIDIFIER : 0) | (r.doorOpen ? RF_DOOR_OPEN : 0) | (timed ? 0 : RF_RELATIVE_TIME);
  for (int i = 0; i < AL_COUNT; i++)
    if (alertActive[i]) rec.alerts |= 1 << i;
  rec.profileVersion = profile.version;
  if (xQueueSend(recordQueue, &rec, 0) != pdTRUE) {
    // The network task is busy (long modem wait): drop the oldest queued reading, keep the newest.
    Record old;
    xQueueReceive(recordQueue, &old, 0);
    xQueueSend(recordQueue, &rec, 0);
  }
}

/** Keeps a new firmware once it has run the room correctly for a while (see verifyRollbackLater). */
void confirmFirmware(unsigned long now) {
  if (firmwareConfirmed || now < OTA_CONFIRM_AFTER_MS || isnan(r.chamberC)) return;
  esp_ota_mark_app_valid_cancel_rollback();
  firmwareConfirmed = true;
}

// ---------------------------------------------------------------- display

void updateDisplay() {
  if (!HAS_LCD) return;
  char line1[17], line2[17];
  // "carro  2.1C  95%"
  snprintf(line1, sizeof(line1), "%-5.5s%5.1fC%4.0f%%", profile.crop, r.chamberC, isnan(r.humidity) ? 0.0f : r.humidity);
  // "H41.2  65% COOL"  (hot side, cooler power, state)
  const char* state = r.doorOpen ? "DOOR" : battState == BATT_CRITICAL ? "BATT" : r.hotSideC > HOT_SIDE_LIMIT_C ? "HOT!" : out.coolerPower > 0 ? "COOL" : "OK  ";
  snprintf(line2, sizeof(line2), "H%4.1f %4.0f%% %s", r.hotSideC, out.coolerPower, state);
  I2cGuard g;
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

// ---------------------------------------------------------------- network task (core 0)

/** Turns a "seconds since boot" time into real time once the clock is known. False if it cannot be dated. */
bool fixTime(Record& rec) {
  if (!(rec.flags & RF_RELATIVE_TIME)) return true;
  if (rec.boot != bootCount || !clk::valid()) return false;  // from an earlier boot: the date is lost
  rec.time += clk::bootTime();
  rec.flags &= ~RF_RELATIVE_TIME;
  return true;
}

/** The reading JSON for the first `n` stored readings. The newest carries what remote overrides are running. */
bool buildReadings(Record* batch, uint32_t n, String& body, uint32_t mqttBatchNo = 0) {
  JsonDocument doc;
  JsonArray readings = doc["readings"].to<JsonArray>();
  JsonObject last;
  for (uint32_t i = 0; i < n; i++) {
    if (!fixTime(batch[i])) continue;
    last = readings.add<JsonObject>();
    recordToJson(batch[i], last, ALERT_CODE, AL_COUNT);
  }
  if (!readings.size()) return false;
  JsonObject ctl = last["control"].to<JsonObject>();
  ctl["targetC"] = controlSnapshot.targetC;
  ctl["targetMinutesLeft"] = controlSnapshot.targetMinutesLeft;
  ctl["coolingOffMinutesLeft"] = controlSnapshot.coolingOffMinutesLeft;
  ctl["insideFanOnMinutesLeft"] = controlSnapshot.insideFanMinutesLeft;
  ctl["hotFanOnMinutesLeft"] = controlSnapshot.hotFanMinutesLeft;
  ctl["insideFanOffMinutesLeft"] = controlSnapshot.insideFanOffMinutesLeft;
  ctl["hotFanOffMinutesLeft"] = controlSnapshot.hotFanOffMinutesLeft;
  ctl["localLock"] = controlSnapshot.localLock;
  if (mqttBatchNo) {  // over MQTT there is no HTTP status: the platform echoes this number once it has stored the batch
    doc["batch"] = mqttBatchNo;
    doc["firmware"] = FW_VERSION;
  }
  serializeJson(doc, body);
  return true;
}

/** Commands the platform put in an HTTPS answer: {"commands":[...]}. */
void takeCommands(const String& json) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return;
  JsonArrayConst list = doc["commands"];
  if (!list.isNull()) queueCommands(list);
}

volatile uint32_t mqttStoredBatch = 0;  // the platform's "stored it" echo
uint32_t mqttBatchNo = 0;

/** Messages from the platform over MQTT. */
void onMqtt(const char* kind, const uint8_t* payload, unsigned length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  if (!strcmp(kind, "command")) {
    RemoteCommand c;
    if (parseCommand(doc.as<JsonVariantConst>(), c)) xQueueSend(commandQueue, &c, 0);
  } else if (!strcmp(kind, "stored")) {
    mqttStoredBatch = doc["batch"] | 0;
  }
}

/** The backup road: the same readings over MQTT, dropped from flash only when the platform confirms them. */
bool uploadViaMqtt(RecordBuffer& buffer, Record* batch, uint32_t n) {
  if (!net::mqttConnected()) return false;
  uint32_t m = min<uint32_t>(n, MQTT_BATCH);
  String body;
  if (!buildReadings(batch, m, body, ++mqttBatchNo)) {
    buffer.drop(m);  // none of them could be dated
    return true;
  }
  mqttStoredBatch = 0;
  if (!net::mqttPublish("readings", body)) return false;
  for (int i = 0; i < 100 && mqttStoredBatch != mqttBatchNo; i++) {  // up to 20 s for the echo
    net::mqttMaintain();
    networkHeartbeat = millis();
    vTaskDelay(pdMS_TO_TICKS(200));
  }
  if (mqttStoredBatch != mqttBatchNo) return false;  // kept: sending it again is safe, each reading is stored once
  buffer.drop(m);
  Serial.printf("%u readings sent over MQTT\n", (unsigned)m);
  return true;
}

/** Sends the oldest stored readings: HTTPS first, MQTT if that fails. True when they were accepted (or there was nothing to send). */
bool uploadBatch(RecordBuffer& buffer) {
  static Record batch[UPLOAD_BATCH];
  uint32_t n = buffer.peek(batch, UPLOAD_BATCH);
  if (!n) return true;
  String body;
  if (!buildReadings(batch, n, body)) {
    buffer.drop(n);
    return true;
  }
  String answer;
  int status = net::request("POST", "/devices/" DEVICE_ID "/readings", body, &answer);
  if (status >= 200 && status < 300) {
    takeCommands(answer);
    buffer.drop(n);
    return true;
  }
  Serial.printf("upload failed (%d), %u readings waiting\n", status, (unsigned)buffer.size());
  return MQTT_ENABLED && uploadViaMqtt(buffer, batch, n);
}

/** Asks the platform for waiting commands over HTTPS. */
bool pollCommands() {
  String answer;
  if (net::request("GET", "/devices/" DEVICE_ID "/commands", "", &answer) != 200) return false;
  takeCommands(answer);
  return true;
}

CommandAck pendingAcks[8];
int pendingAckCount = 0;

/** Tells the platform what the control loop did with a command: HTTPS first, MQTT as the backup. */
bool sendAck(const CommandAck& a) {
  char path[64];
  snprintf(path, sizeof path, "/devices/" DEVICE_ID "/commands/%u/ack", (unsigned)a.id);
  JsonDocument doc;
  doc["ok"] = a.ok;
  doc["message"] = a.message;
  String body;
  serializeJson(doc, body);
  if (net::request("POST", path, body, nullptr) == 200) return true;
  doc["id"] = a.id;
  body = "";
  serializeJson(doc, body);
  return net::mqttPublish("ack", body);
}

void sendPendingAcks() {
  CommandAck a;
  while (xQueueReceive(ackQueue, &a, 0) == pdTRUE) {
    if (pendingAckCount == 8) memmove(pendingAcks, pendingAcks + 1, 7 * sizeof(CommandAck)), pendingAckCount--;
    pendingAcks[pendingAckCount++] = a;
  }
  while (pendingAckCount > 0) {
    if (!sendAck(pendingAcks[0])) break;  // try again next round
    memmove(pendingAcks, pendingAcks + 1, (pendingAckCount - 1) * sizeof(CommandAck));
    pendingAckCount--;
  }
}

bool fetchProfile() {
  String body;
  if (net::request("GET", "/devices/" DEVICE_ID "/profile", "", &body) != 200) return false;
  CropProfile p;
  if (profileFromJson(body.c_str(), p)) xQueueOverwrite(profileQueue, &p);
  else Serial.println("profile rejected: invalid or unsafe values");
  return true;
}

void networkTask(void*) {
  networkHeartbeat = millis();
  RecordBuffer buffer;
  if (!buffer.begin(BUFFER_RECORDS)) Serial.println("flash storage failed: readings are not kept while offline");
  Serial.printf("%u readings waiting from before the restart\n", (unsigned)buffer.size());
  net::begin();
  net::mqttBegin(onMqtt);

  const uint32_t start = millis();
  uint32_t nextUpload = 0, backoff = 10000, nextProfile = 0, nextClockTry = 0, nextCommandPoll = 20000;
  uint32_t nextOta = start + 120000UL;  // first check 2 min after start
  auto due = [](uint32_t at) { return (int32_t)(millis() - at) >= 0; };

  for (;;) {
    networkHeartbeat = millis();

    Record rec;
    while (xQueueReceive(recordQueue, &rec, 0) == pdTRUE) {
      fixTime(rec);
      buffer.push(rec);
    }

    SmsMessage sms;
    while (xQueueReceive(smsQueue, &sms, 0) == pdTRUE) {
      net::sendSms(ALERT_PHONE_1, sms.text);
      net::sendSms(ALERT_PHONE_2, sms.text);
    }

    if (!clk::valid() && due(nextClockTry)) {
      nextClockTry = millis() + 300000UL;
      if (net::connect()) net::syncClock();
    }
    clk::maintain();

    // Readings are only sent once they can carry a real date.
    if (buffer.size() && clk::valid() && due(nextUpload)) {
      if (uploadBatch(buffer)) {
        backoff = 10000;
        nextUpload = buffer.size() ? millis() : millis() + RECORD_INTERVAL_MS / 2;  // catch up quickly after an outage
      } else {
        nextUpload = millis() + backoff;
        backoff = min<uint32_t>(backoff * 2, 300000UL);
      }
    }

    net::mqttMaintain();  // MQTT stays connected in the background: commands arrive at once, and it carries readings if HTTPS fails

    if (due(nextCommandPoll)) nextCommandPoll = millis() + (pollCommands() ? COMMAND_POLL_MS : 4 * COMMAND_POLL_MS);
    sendPendingAcks();

    if (due(nextProfile)) nextProfile = millis() + (fetchProfile() ? PROFILE_INTERVAL_MS : 60000UL);

    if (due(nextOta)) {
      nextOta = millis() + OTA_CHECK_INTERVAL_MS;
      net::checkForUpdate();  // restarts the controller if it installs something
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// ---------------------------------------------------------------- discovery

void printSensorAddresses() {
  DeviceAddress a;
  Serial.printf("Found %d DS18B20 sensor(s):\n", ds.getDeviceCount());
  for (int i = 0; ds.getAddress(a, i); i++) {
    ds.requestTemperatures();
    Serial.print("  {");
    for (int b = 0; b < 8; b++) Serial.printf("0x%02X%s", a[b], b < 7 ? ", " : "");
    Serial.printf("}  now %.2f C\n", ds.getTempC(a));
  }
}

// ---------------------------------------------------------------- setup / loop

void setup() {
  Serial.begin(115200);
  // Cooler off before anything else (the MOSFET gate also has a pull-down resistor, see README).
  pinMode(PIN_COOLER_PWM, OUTPUT);
  digitalWrite(PIN_COOLER_PWM, LOW);
  ledcAttach(PIN_COOLER_PWM, COOLER_PWM_HZ, 10);
  setCoolerPwm(0);
  for (int pin : {PIN_RELAY_HOT_FAN, PIN_RELAY_INNER_FAN, PIN_RELAY_HUMIDIFIER}) {
    pinMode(pin, OUTPUT);
    setRelay(pin, false);  // everything off at boot
  }
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_DOOR_SWITCH, INPUT_PULLUP);
  if (HAS_LOCAL_LOCK) pinMode(PIN_LOCAL_LOCK, INPUT_PULLUP);
  analogReadResolution(12);

  ds.begin();
  ds.setResolution(12);
  if (DISCOVERY_MODE) {
    while (true) {
      printSensorAddresses();
      delay(3000);
    }
  }
  ds.requestTemperatures();          // one blocking conversion so the first readings are real
  ds.setWaitForConversion(false);    // from now on: start a conversion, read it next cycle
  ds.requestTemperatures();

  i2cLock = xSemaphoreCreateMutex();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  shtOk = sht31.begin(SHT31_I2C_ADDRESS);
  if (!shtOk) Serial.println("SHT31 not found: humidity disabled");
  meterOk = power::begin();
  solarMeterOk = solar::begin();
  if (HAS_SOLAR_METER && !solarMeterOk) Serial.println("solar meter not found: no solar generation figure");
  if (HAS_POWER_METER && !meterOk) Serial.println("INA226 power meter not found: no current, energy or dead-module check");
  if (HAS_LCD) {
    lcd.init();
    lcd.backlight();
  }
  clk::begin();

  Preferences prefs;
  prefs.begin("hh", false);
  bootCount = prefs.getUShort("boots", 0) + 1;
  prefs.putUShort("boots", bootCount);
  prefs.end();

  profile = profileLoad();
  Serial.printf("Harvest Hold firmware %d, boot %u, profile %s v%u target %.1fC\n", FW_VERSION, bootCount, profile.crop, profile.version, profile.targetC);

  recordQueue = xQueueCreate(30, sizeof(Record));
  smsQueue = xQueueCreate(6, sizeof(SmsMessage));
  profileQueue = xQueueCreate(1, sizeof(CropProfile));
  commandQueue = xQueueCreate(8, sizeof(RemoteCommand));
  ackQueue = xQueueCreate(8, sizeof(CommandAck));

  // Watchdog for this control loop: if it stops checking in, the ESP32 restarts (relays start OFF).
  esp_task_wdt_config_t wdt = {.timeout_ms = CONTROL_WATCHDOG_S * 1000, .idle_core_mask = 0, .trigger_panic = true};
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);
  esp_task_wdt_add(NULL);

  xTaskCreatePinnedToCore(networkTask, "network", 20480, nullptr, 1, nullptr, 0);

  lastCirculation = millis();
}

void loop() {
  unsigned long now = millis();
  esp_task_wdt_reset();

  if (now - lastControl >= CONTROL_INTERVAL_MS) {
    lastControl = now;
    applyNewProfile();
    readSensors();
    readLocalLock();
    applyCommands(now);
    endUnsafeOverrides(now);
    publishControlSnapshot(now);
    updateBatteryState();
    controlCooler(now);
    controlHumidity(now);
    applyOutputs();
    checkAlerts(now);
    updateDisplay();
    recordReading(now);
    confirmFirmware(now);
  }

  // The network task may wait on the modem for a while, but not forever.
  if (now - networkHeartbeat > NETWORK_WATCHDOG_MS) {
    Serial.println("network task stuck: restarting");
    ESP.restart();
  }
  delay(10);
}
