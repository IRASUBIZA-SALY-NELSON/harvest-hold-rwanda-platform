#pragma once
// =====================================================================================
//  Harvest Hold cold room controller: settings for ONE cold room.
//  Everything marked PLACEHOLDER must be changed to match your wiring and account.
//
//  Board: "ESP32 Dev Module", Partition scheme: "Custom" (uses partitions.csv in this folder).
// =====================================================================================

// Whole number. Raise it for every release: controllers install any newer version the server offers.
#define FW_VERSION 3

// ---------- Pins (PLACEHOLDERS: match them to your wiring) ----------
// Use ADC1 pins (32-39) for analog readings: ADC2 pins stop working while Wi-Fi is on.
#define PIN_ONEWIRE            4   // DS18B20 data line (4.7k pull-up to 3.3V)
#define PIN_I2C_SDA           21   // SHT31, DS3231 clock, LCD
#define PIN_I2C_SCL           22
#define PIN_RELAY_COMPRESSOR  26   // compressor enable (or its controller's thermostat input)
#define PIN_RELAY_PUMP        27   // submersible water pump
#define PIN_RELAY_FAN         25   // chamber fan
#define PIN_RELAY_HUMIDIFIER  33   // ultrasonic humidifier (optional, see README)
#define PIN_DOOR_SWITCH       14   // reed switch to GND; reads LOW when the door is closed
#define PIN_BATTERY_ADC       34   // battery voltage through a divider
#define PIN_SOLAR_ADC         35   // solar panel voltage through a divider
#define PIN_MODEM_RX          16   // ESP32 RX  <- SIM7600 TX
#define PIN_MODEM_TX          17   // ESP32 TX  -> SIM7600 RX
#define PIN_MODEM_PWRKEY      13   // SIM7600 PWRKEY (most boards drive it through a transistor)
#define PIN_STATUS_LED         2

#define RELAY_ACTIVE_LOW    true   // most cheap relay boards switch ON when the pin is LOW
// Off by default: ultrasonic misters clog fast with hard (volcanic) water and can wet the crop.
// Use perforated crate liners + a damp brick floor first; see crop-profiles/carrot.json.
#define HAS_HUMIDIFIER      false
#define HAS_LCD             true
#define LCD_I2C_ADDRESS     0x27   // PLACEHOLDER: often 0x27 or 0x3F
#define SHT31_I2C_ADDRESS   0x44
// DS3231 battery-backed clock (I2C 0x68): keeps the time through power cuts and while offline.
#define HAS_DS3231          true

// Voltage dividers: ratio = (R_top + R_bottom) / R_bottom. Measure with a multimeter and adjust.
#define BATTERY_DIVIDER     5.7f   // PLACEHOLDER: 47k / 10k  -> max ~18.8V
#define SOLAR_DIVIDER       11.0f  // PLACEHOLDER: 100k / 10k -> max ~36V

// ---------- DS18B20 addresses (PLACEHOLDERS) ----------
// Set DISCOVERY_MODE to true, flash, open Serial Monitor (115200): it prints every sensor's
// address. Warm one sensor in your hand to tell which is which, paste the addresses here,
// then set DISCOVERY_MODE back to false.
#define DISCOVERY_MODE      false
// CHAMBER_AIR: middle of the room, between crates, away from the coil. This is the room temperature.
// COIL_OUTLET: in the cold air leaving the radiator, where the nearest crates sit. Coldest spot:
//              the freeze guard watches this one.
static const uint8_t ADDR_CHAMBER_AIR[8]    = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01};
static const uint8_t ADDR_COIL_OUTLET[8]    = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02};
static const uint8_t ADDR_PRODUCT[8]        = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03}; // probe inside a carrot / crate centre
static const uint8_t ADDR_ICE_BANK[8]       = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04};
static const uint8_t ADDR_OUTSIDE[8]        = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05};

// ---------- Internet connection ----------
#define NET_WIFI_ONLY           1
#define NET_CELLULAR_ONLY       2
#define NET_WIFI_THEN_CELLULAR  3   // Wi-Fi when available, otherwise 4G
#define NETWORK_MODE        NET_WIFI_THEN_CELLULAR
#define HAS_MODEM           (NETWORK_MODE != NET_WIFI_ONLY)

#define WIFI_SSID        "YOUR_WIFI"            // PLACEHOLDER
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"   // PLACEHOLDER

// SIM7600 4G modem (LTE, falls back to 3G/2G where needed). Also sends the SMS alerts.
#define MODEM_BAUD       115200
#define CELL_APN         "YOUR_APN"   // PLACEHOLDER: ask the SIM operator (MTN or Airtel Rwanda)
#define CELL_USER        ""
#define CELL_PASSWORD    ""
#define SIM_PIN          ""           // leave empty if the SIM has no PIN

// ---------- Backend (PLACEHOLDERS) ----------
#define API_HOST         "api.example.com"            // your backend, without https://
#define API_PORT         443
#define API_TLS          true                          // false only for a local test server
#define DEVICE_ID        "cr-musanze"                  // cold room id, same as in the app
#define DEVICE_TOKEN     "REPLACE_WITH_DEVICE_TOKEN"   // issued by the backend for this device
// Root CA of your API's certificate (PEM, between the quotes of R"( ... )"). Leave empty ONLY
// while testing: the connection is then encrypted but the server is not verified.
#define API_ROOT_CA      ""
#define NTP_SERVER       "pool.ntp.org"

// ---------- SMS alerts (PLACEHOLDERS) ----------
#define ALERT_PHONE_1    "+250780000000"   // farmer / operator
#define ALERT_PHONE_2    ""                // optional second number

// ---------- Ice bank (tune on the real tank) ----------
// The sensor sits in the water, away from the evaporator coil.
//  - Water above ICE_EMPTY_C means the ice is almost gone: the compressor must run.
//  - Below ICE_FULL_C the water around the sensor has frozen: the bank is full, stop.
#define ICE_EMPTY_C          1.0f
#define ICE_FULL_C          -2.0f
// Pumping is useless when the ice bank is not colder than the chamber by at least this much.
#define ICE_USEFUL_DELTA_C   1.5f

// ---------- Battery (12V AGM) ----------
#define BATT_COMPRESSOR_OFF_V   12.0f  // below: no compressor (it is the biggest load)
#define BATT_COMPRESSOR_ON_V    12.6f  // back on above this
#define BATT_CRITICAL_V         11.6f  // below: only the controller and SMS stay on
#define BATT_RECOVER_V          12.3f
#define SOLAR_CHARGING_MARGIN_V  1.0f  // panel this much above battery = charging
#define SOLAR_SURPLUS_BATT_V    13.2f  // battery this high while charging = spare solar power

// ---------- Readings kept while offline ----------
// One reading per minute is stored in flash and sent when the connection is back, oldest first.
// 10 000 readings is about 7 days; when full, the oldest are overwritten.
#define RECORD_INTERVAL_MS      60000UL
#define BUFFER_RECORDS          10000
#define UPLOAD_BATCH            120     // readings per upload request

// ---------- Timing ----------
#define CONTROL_INTERVAL_MS        2000UL
#define PROFILE_INTERVAL_MS      600000UL   // fetch the crop profile every 10 min
#define OTA_CHECK_INTERVAL_MS  21600000UL   // look for new firmware every 6 h
#define OTA_CONFIRM_AFTER_MS     300000UL   // new firmware must control the room for 5 min before it is kept
#define COMPRESSOR_MIN_ON_MS     600000UL   // 10 min
#define COMPRESSOR_MIN_OFF_MS    180000UL   // 3 min, protects the compressor
#define PUMP_MIN_SWITCH_MS        60000UL
#define DOOR_ALERT_MS            180000UL   // door open for 3 min
#define CIRCULATION_EVERY_MS     900000UL   // stir the air every 15 min even when not cooling
#define CIRCULATION_FOR_MS       120000UL
#define HUMIDIFIER_MAX_ON_MS     300000UL   // never mist for more than 5 min in a row
#define ALERT_REPEAT_MS         7200000UL   // repeat an unresolved SMS alert every 2 h

// ---------- Watchdogs ----------
// The control loop must check in every CONTROL_WATCHDOG_S or the ESP32 restarts (relays start OFF).
#define CONTROL_WATCHDOG_S          30
// The network task may legitimately wait a long time on the modem; if it is silent this long,
// the controller restarts.
#define NETWORK_WATCHDOG_MS     600000UL
