#pragma once
// =====================================================================================
//  Harvest Hold cold room controller (Peltier prototype): settings for ONE cold room.
//  Everything marked PLACEHOLDER must be changed to match your wiring and account.
//
//  Board: "ESP32 Dev Module", Partition scheme: "Custom" (uses partitions.csv in this folder).
// =====================================================================================

// Whole number. Raise it for every release: controllers install any newer version the server offers.
#define FW_VERSION 5

// ---------- Pins (PLACEHOLDERS: match them to your wiring) ----------
// Use ADC1 pins (32-39) for analog readings: ADC2 pins stop working while Wi-Fi is on.
#define PIN_ONEWIRE            4   // DS18B20 data line (4.7k pull-up to 3.3V)
#define PIN_I2C_SDA           21   // SHT31, DS3231 clock, INA226 power meter, LCD
#define PIN_I2C_SCL           22
#define PIN_COOLER_PWM        26   // gate of the logic-level MOSFET that powers the Peltier module(s)
#define PIN_RELAY_HOT_FAN     27   // fan on the hot-side heatsink
#define PIN_RELAY_INNER_FAN   25   // fan on the cold-side heatsink, inside the chamber
#define PIN_RELAY_HUMIDIFIER  33   // ultrasonic humidifier (optional, see README)
#define PIN_DOOR_SWITCH       14   // reed switch to GND; reads LOW when the door is closed
#define PIN_BATTERY_ADC       34   // battery voltage through a divider
#define PIN_SOLAR_ADC         35   // solar panel voltage through a divider
#define PIN_MODEM_RX          16   // ESP32 RX  <- SIM7600 TX
#define PIN_MODEM_TX          17   // ESP32 TX  -> SIM7600 RX
#define PIN_MODEM_PWRKEY      13   // SIM7600 PWRKEY (most boards drive it through a transistor)
#define PIN_STATUS_LED         2
#define PIN_LOCAL_LOCK        15   // optional on-site key switch to GND: ON = people at the room are in charge (see HAS_LOCAL_LOCK)

#define RELAY_ACTIVE_LOW    true   // most cheap relay boards switch ON when the pin is LOW
// Off by default: ultrasonic misters clog fast with hard (volcanic) water and can wet the crop.
// Use perforated crate liners + a damp brick floor first; see crop-profiles/carrot.json.
#define HAS_HUMIDIFIER      false
#define HAS_LCD             true
#define LCD_I2C_ADDRESS     0x27   // PLACEHOLDER: often 0x27 or 0x3F
#define SHT31_I2C_ADDRESS   0x44
// INA226 power meter on the Peltier supply: current, voltage and energy, and it shows a dead module.
#define HAS_POWER_METER     true
#define INA226_I2C_ADDRESS  0x40
#define INA226_SHUNT_OHMS   0.01f  // PLACEHOLDER: the shunt resistor on your module ("R010" = 0.01 ohm, up to 8 A)
// Optional second INA226 on the solar panel's wire: measures solar generation (A) so the platform can
// report kWh generated. Without it the platform shows panel voltage and "charging" only.
#define HAS_SOLAR_METER     false
#define INA226_SOLAR_I2C_ADDRESS 0x41   // bridge A0 to VS on the module to change its address from 0x40
#define INA226_SOLAR_SHUNT_OHMS  0.01f
// false when the prototype runs from a mains 12 V power supply instead of a solar battery.
#define HAS_BATTERY         true
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
// CHAMBER_AIR: middle of the chamber, between crates, away from the cooler. This is the room temperature.
// COLD_AIR:    in the cold air blown off the cold-side heatsink, where the nearest crates sit.
//              Coldest spot: the freeze guard watches this one.
// HOT_SIDE:    clipped or glued to the hot-side heatsink, next to the module. Protects the module.
static const uint8_t ADDR_CHAMBER_AIR[8]    = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01};
static const uint8_t ADDR_COLD_AIR[8]       = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02};
static const uint8_t ADDR_PRODUCT[8]        = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03}; // probe inside a carrot / crate centre
static const uint8_t ADDR_HOT_SIDE[8]       = {0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04};
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
#define DEVICE_ID        "HHR-001"                     // cold room id (HHR-001, HHR-002, ...), same as in the portal
#define DEVICE_TOKEN     "REPLACE_WITH_DEVICE_TOKEN"   // issued by the backend for this device
// Root CA of your API's certificate (PEM, between the quotes of R"( ... )"). Leave empty ONLY
// while testing: the connection is then encrypted but the server is not verified.
#define API_ROOT_CA      ""
#define NTP_SERVER       "pool.ntp.org"

// ---------- MQTT backup channel ----------
// HTTPS is the road in use. MQTT is a second one, OFF for now: when switched on (here AND in the
// platform's MQTT_ENABLED) it carries remote commands at once and takes the readings when HTTPS fails.
// Over the internet use TLS (port 8883, a proxy in front of the platform's MQTT port).
#define MQTT_ENABLED     false
#define MQTT_HOST        API_HOST
#define MQTT_PORT        8883
#define MQTT_TLS         true                          // false only for a local test broker (port 1883)
#define MQTT_BATCH       20                            // readings per message when HTTPS is down
#define MQTT_KEEPALIVE_S 90

// ---------- On-site control ----------
// A key switch at the cold room. While it is ON (pin LOW) the platform's remote commands are refused
// and any remote override is cancelled, so whoever is at the room is never fought by someone far away.
// The room still controls its temperature automatically and its safety limits still apply.
#define HAS_LOCAL_LOCK      false

// ---------- Remote control ----------
// Commands from the platform are timed overrides. They end by themselves and never beat the freeze
// guard, the hot-side limits or the battery protection. Longest allowed (minutes):
#define REMOTE_MAX_TARGET_MIN    1440
#define REMOTE_MAX_COOLING_OFF   1440
#define REMOTE_MAX_FAN_ON        1440
#define REMOTE_TARGET_MARGIN_C   0.5f   // a remote target keeps this distance from the alarm limits
#define COMMAND_POLL_MS          15000UL   // ask for commands over HTTPS (they also arrive in upload answers and over MQTT)

// ---------- SMS alerts (PLACEHOLDERS) ----------
#define ALERT_PHONE_1    "+250780000000"   // farmer / operator
#define ALERT_PHONE_2    ""                // optional second number

// ---------- Peltier cooler (tune on the real box) ----------
// Power is varied smoothly (PWM) instead of switched on and off: a Peltier module that is fully
// off lets heat leak back into the box, and on/off cycling wears the module out.
#define COOLER_PWM_HZ           20000   // above hearing; through a logic-level MOSFET (e.g. IRLZ44N)
#define COOLER_KP               25.0f   // % power per °C above target
#define COOLER_KI               0.6f    // % power per °C per minute, builds up while too warm
#define COOLER_MIN_POWER        15.0f   // below this the module does more harm than good: run at least this, or off
#define COOLER_MAX_STEP         6.0f    // % change per 2 s cycle: avoids thermal shock to the module
// Hot side: the module fails if its hot side overheats. Power is reduced from LIMIT and cut at CUTOFF.
#define HOT_SIDE_LIMIT_C        55.0f
#define HOT_SIDE_CUTOFF_C       65.0f
#define HOT_FAN_RUN_ON_MS       120000UL  // keep the hot-side fan running after the module stops
// Cold side: below this the heatsink frosts up and blocks the air; power is limited.
#define COLD_SINK_FROST_C       -3.0f
// Alerts
#define CAPACITY_ALERT_MS       3600000UL // at full power for 1 h and still above target
#define FAULT_MIN_CURRENT_A     0.3f      // asked for power but the meter sees almost no current

// ---------- Battery (12V AGM) ----------
#define BATT_SAVING_V           12.0f  // below: cooler power limited to BATT_SAVING_POWER
#define BATT_RECOVER_SAVING_V   12.6f  // full power again above this
#define BATT_SAVING_POWER       40.0f  // % cooler power while saving the battery
#define BATT_CRITICAL_V         11.6f  // below: cooler off; only the controller and SMS stay on
#define BATT_RECOVER_V          12.3f
#define SOLAR_CHARGING_MARGIN_V  1.0f  // panel this much above battery = charging

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
