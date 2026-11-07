// =====================================================================================
//  Harvest Hold Rwanda: cold room controller (ESP32)
//
//  Solar panel -> battery -> compressor freezes the ice bank -> pump sends ice water to the
//  chamber radiator -> fan blows chamber air over the radiator.
//
//  Two tasks:
//   - Control (this loop, core 1): sensors, relays, freeze guard, alerts. Never waits on the
//     network, so the freeze guard always reacts within one control cycle (2 s).
//   - Network (core 0): stores readings in flash, uploads them when online (Wi-Fi or 4G),
//     sends SMS, fetches the crop profile, keeps the clock right, installs firmware updates.
//
//  Libraries (Arduino Library Manager): OneWire, DallasTemperature, Adafruit SHT31 Library,
//  ArduinoJson (v7), LiquidCrystal I2C (Frank de Brabander), RTClib, TinyGSM, ArduinoHttpClient,
//  ESP_SSLClient. Board: ESP32 Dev Module, Partition scheme: Custom (partitions.csv).
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
#include "record.h"
#include "record_buffer.h"
#include "shared.h"

// ---------------------------------------------------------------- shared with the network task

QueueHandle_t recordQueue, smsQueue, profileQueue;
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
  float chamberC = NAN;   // room air, used for cooling and alarms
  float coilC = NAN;      // air leaving the coil
  float coldestC = NAN;   // coldest of the two: used for the freeze guard
  float productC = NAN;   // probe inside the produce
  float iceBankC = NAN;
  float outsideC = NAN;
  float humidity = NAN;
  float batteryV = NAN;
  float solarV = NAN;
  bool doorOpen = false;
  bool solarCharging = false;
} r;

struct Outputs {
  bool compressor = false, pump = false, fan = false, humidifier = false;
} out;

enum BatteryState { BATT_OK, BATT_SAVING, BATT_CRITICAL };
BatteryState battState = BATT_OK;

unsigned long compressorChangedAt = 0, pumpChangedAt = 0, humidifierOnAt = 0;
unsigned long doorOpenedAt = 0, lastCirculation = 0;
unsigned long lastControl = 0, lastRecord = 0;
unsigned long tooWarmSince = 0, tooColdSince = 0;
bool cooling = false;
bool shtOk = false;
bool firmwareConfirmed = false;

// ---------------------------------------------------------------- alerts

enum AlertId { AL_TOO_WARM, AL_TOO_COLD, AL_BATTERY_LOW, AL_ICE_EMPTY, AL_DOOR_OPEN, AL_SENSOR_FAIL, AL_COUNT };
const char* const ALERT_CODE[AL_COUNT] = {"chamber_warm", "chamber_cold", "battery_low", "ice_bank_low", "door_open", "sensor_fail"};
bool alertActive[AL_COUNT] = {false};
unsigned long alertSentAt[AL_COUNT] = {0};

// After a firmware update the new version is on probation: if it crashes or hangs before
// confirmFirmware() runs, the bootloader goes back to the previous version.
bool verifyRollbackLater() { return true; }

// ---------------------------------------------------------------- helpers

void setRelay(int pin, bool on) { digitalWrite(pin, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW); }

float readTemp(const uint8_t* addr) {
  float t = ds.getTempC(addr);
  // 85.0 is what a DS18B20 reports before its first conversion: never a real reading here.
  return (t == DEVICE_DISCONNECTED_C || t < -50 || t > 80 || t == 85.0f) ? NAN : t;
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
  r.coilC = readTemp(ADDR_COIL_OUTLET);
  r.productC = readTemp(ADDR_PRODUCT);
  r.iceBankC = readTemp(ADDR_ICE_BANK);
  r.outsideC = readTemp(ADDR_OUTSIDE);
  ds.requestTemperatures();

  // Not smoothed: the freeze guard must react fast. Each sensor stands in for the other if one fails.
  r.chamberC = !isnan(air) ? air : r.coilC;
  r.coldestC = !isnan(r.coilC) && !isnan(air) ? min(air, r.coilC) : r.chamberC;

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

  r.batteryV = smooth(r.batteryV, readVoltage(PIN_BATTERY_ADC, BATTERY_DIVIDER));
  r.solarV = smooth(r.solarV, readVoltage(PIN_SOLAR_ADC, SOLAR_DIVIDER));
  r.solarCharging = r.solarV > r.batteryV + SOLAR_CHARGING_MARGIN_V;

  bool open = digitalRead(PIN_DOOR_SWITCH) == HIGH;
  if (open && !r.doorOpen) doorOpenedAt = millis();
  r.doorOpen = open;
}

// ---------------------------------------------------------------- control

void updateBatteryState() {
  float v = r.batteryV;
  if (isnan(v)) return;
  switch (battState) {
    case BATT_OK:       if (v < BATT_CRITICAL_V) battState = BATT_CRITICAL; else if (v < BATT_COMPRESSOR_OFF_V) battState = BATT_SAVING; break;
    case BATT_SAVING:   if (v < BATT_CRITICAL_V) battState = BATT_CRITICAL; else if (v > BATT_COMPRESSOR_ON_V) battState = BATT_OK; break;
    case BATT_CRITICAL: if (v > BATT_RECOVER_V) battState = BATT_SAVING; break;
  }
}

void controlCompressor(unsigned long now) {
  bool want = out.compressor;
  bool iceEmpty = !isnan(r.iceBankC) && r.iceBankC > ICE_EMPTY_C;
  bool iceFull = !isnan(r.iceBankC) && r.iceBankC < ICE_FULL_C;
  bool spareSolar = r.solarCharging && r.batteryV > SOLAR_SURPLUS_BATT_V;

  if (iceFull) want = false;
  else if (spareSolar) want = true;                           // make ice whenever the sun pays for it
  else if (iceEmpty && battState == BATT_OK) want = true;     // at night only when the ice runs out
  else if (!r.solarCharging && !iceEmpty) want = false;       // save the battery while ice remains

  if (isnan(r.iceBankC)) want = spareSolar;                   // sensor lost: only run on spare solar
  if (battState != BATT_OK) want = false;

  unsigned long held = now - compressorChangedAt;
  if (want && !out.compressor && held < COMPRESSOR_MIN_OFF_MS) return;
  if (!want && out.compressor && held < COMPRESSOR_MIN_ON_MS && battState == BATT_OK && !iceFull) return;
  if (want != out.compressor) {
    out.compressor = want;
    compressorChangedAt = now;
  }
}

void controlCooling(unsigned long now) {
  float t = r.chamberC;
  bool sensorLost = isnan(t);

  if (sensorLost) {
    // No chamber reading: run 10 min on / 10 min off so the crop is not left warm.
    cooling = (now / 600000UL) % 2 == 0;
  } else if (t > profile.targetC + profile.hysteresisC) {
    cooling = true;
  } else if (t < profile.targetC - profile.hysteresisC) {
    cooling = false;
  }

  bool iceUseful = isnan(r.iceBankC) || isnan(t) || r.iceBankC < t - ICE_USEFUL_DELTA_C;
  bool freezing = !isnan(r.coldestC) && r.coldestC < profile.freezeGuardC;

  bool pump = cooling && iceUseful && !freezing && battState != BATT_CRITICAL;
  if (pump != out.pump && now - pumpChangedAt >= PUMP_MIN_SWITCH_MS) {
    out.pump = pump;
    pumpChangedAt = now;
  }
  if (freezing) out.pump = false;  // the freeze guard ignores the minimum switch time

  // Fan: with the pump, plus a short stir every 15 min so the room stays even.
  bool stir = now - lastCirculation < CIRCULATION_FOR_MS;
  if (now - lastCirculation > CIRCULATION_EVERY_MS) lastCirculation = now;
  out.fan = (out.pump || stir) && !r.doorOpen && battState != BATT_CRITICAL;
}

void controlHumidity(unsigned long now) {
  if (!HAS_HUMIDIFIER) return;
  bool allowed = !isnan(r.humidity) && !r.doorOpen && battState == BATT_OK && out.fan;
  bool want = out.humidifier;
  if (r.humidity < profile.rhLow) want = true;
  if (r.humidity > profile.rhHigh) want = false;
  if (!allowed) want = false;
  if (want && !out.humidifier) humidifierOnAt = now;
  if (want && now - humidifierOnAt > HUMIDIFIER_MAX_ON_MS) want = false;  // rest so crops never get wet
  out.humidifier = want;
}

void checkAlerts(unsigned long now) {
  float t = r.chamberC;
  unsigned long grace = profile.alarmGraceMin * 60000UL;

  if (!isnan(t) && t > profile.alarmHighC) { if (!tooWarmSince) tooWarmSince = now; } else tooWarmSince = 0;
  float cold = r.coldestC;
  if (!isnan(cold) && cold < profile.alarmLowC) { if (!tooColdSince) tooColdSince = now; } else tooColdSince = 0;

  updateAlert(AL_TOO_WARM, tooWarmSince && now - tooWarmSince > grace, String("chamber too warm ") + String(t, 1) + "C");
  updateAlert(AL_TOO_COLD, tooColdSince && now - tooColdSince > 600000UL, String("too cold near the coil ") + String(cold, 1) + "C, crops may freeze");
  updateAlert(AL_BATTERY_LOW, battState != BATT_OK, String("battery low ") + String(r.batteryV, 1) + "V");
  updateAlert(AL_ICE_EMPTY, !isnan(r.iceBankC) && !isnan(t) && r.iceBankC > t - ICE_USEFUL_DELTA_C && cooling, "ice bank is not cold enough");
  updateAlert(AL_DOOR_OPEN, r.doorOpen && now - doorOpenedAt > DOOR_ALERT_MS, "door open for more than 3 min");
  updateAlert(AL_SENSOR_FAIL, isnan(t) || isnan(r.iceBankC), "temperature sensor not responding");
}

void applyOutputs() {
  setRelay(PIN_RELAY_COMPRESSOR, out.compressor);
  setRelay(PIN_RELAY_PUMP, out.pump);
  setRelay(PIN_RELAY_FAN, out.fan);
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
  rec.coilOutlet = packTemp(r.coilC);
  rec.product = packTemp(r.productC);
  rec.iceBank = packTemp(r.iceBankC);
  rec.outside = packTemp(r.outsideC);
  rec.humidity = packPercent(r.humidity);
  rec.battery = packPercent(batteryPercent(r.batteryV));
  rec.batteryCv = packVolts(r.batteryV);
  rec.solarCv = packVolts(r.solarV);
  rec.flags = (r.solarCharging ? RF_SOLAR_CHARGING : 0) | (out.pump ? RF_PUMP : 0) | (out.fan ? RF_FAN : 0) |
              (out.compressor ? RF_COMPRESSOR : 0) | (out.humidifier ? RF_HUMIDIFIER : 0) |
              (r.doorOpen ? RF_DOOR_OPEN : 0) | (timed ? 0 : RF_RELATIVE_TIME);
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
  // "I-1.2 12.7V COOL"
  const char* state = r.doorOpen ? "DOOR" : battState == BATT_CRITICAL ? "BATT" : out.pump ? "COOL" : out.compressor ? "ICE " : "OK  ";
  snprintf(line2, sizeof(line2), "I%4.1f %4.1fV %s", r.iceBankC, r.batteryV, state);
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

/** Sends the oldest stored readings. True when they were accepted (or there was nothing to send). */
bool uploadBatch(RecordBuffer& buffer) {
  static Record batch[UPLOAD_BATCH];
  uint32_t n = buffer.peek(batch, UPLOAD_BATCH);
  if (!n) return true;
  JsonDocument doc;
  JsonArray readings = doc["readings"].to<JsonArray>();
  for (uint32_t i = 0; i < n; i++) {
    if (fixTime(batch[i])) recordToJson(batch[i], readings.add<JsonObject>(), ALERT_CODE, AL_COUNT);
  }
  if (readings.size()) {
    String body;
    serializeJson(doc, body);
    int status = net::request("POST", "/devices/" DEVICE_ID "/readings", body, nullptr);
    if (status < 200 || status >= 300) {
      Serial.printf("upload failed (%d), %u readings waiting\n", status, (unsigned)buffer.size());
      return false;
    }
  }
  buffer.drop(n);
  return true;
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

  const uint32_t start = millis();
  uint32_t nextUpload = 0, backoff = 10000, nextProfile = 0, nextClockTry = 0;
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
  for (int pin : {PIN_RELAY_COMPRESSOR, PIN_RELAY_PUMP, PIN_RELAY_FAN, PIN_RELAY_HUMIDIFIER}) {
    pinMode(pin, OUTPUT);
    setRelay(pin, false);  // everything off at boot
  }
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_DOOR_SWITCH, INPUT_PULLUP);
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

  // Watchdog for this control loop: if it stops checking in, the ESP32 restarts (relays start OFF).
  esp_task_wdt_config_t wdt = {.timeout_ms = CONTROL_WATCHDOG_S * 1000, .idle_core_mask = 0, .trigger_panic = true};
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);
  esp_task_wdt_add(NULL);

  xTaskCreatePinnedToCore(networkTask, "network", 20480, nullptr, 1, nullptr, 0);

  unsigned long now = millis();
  compressorChangedAt = now - COMPRESSOR_MIN_OFF_MS;  // allow a start right away
  pumpChangedAt = now - PUMP_MIN_SWITCH_MS;
  lastCirculation = now;
}

void loop() {
  unsigned long now = millis();
  esp_task_wdt_reset();

  if (now - lastControl >= CONTROL_INTERVAL_MS) {
    lastControl = now;
    applyNewProfile();
    readSensors();
    updateBatteryState();
    controlCompressor(now);
    controlCooling(now);
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
