# Harvest Hold: automatic cold room control

**Prototype: Peltier cooling.** `harvest_hold_controller/` drives one or more Peltier modules
(thermoelectric coolers). The full-size design with compressor, ice bank and water pump is kept in
[`archive/ice_bank_controller/`](archive/) for scale-up. Both share the same monitoring, offline
buffer, 4G, alerts and updates, and the backend and app handle either kind of room.

## What the system bases its decisions on

The controller does not guess. Each decision comes from one of three things:

1. **The crop profile.** The backend knows which crop is in the room, because the farmer
   records it in the app when adding stock. It sends that crop's profile to the controller:
   target temperature, alarm limits, humidity range and freeze guard. The first profile is
   **carrot** ([../crop-profiles/carrot.json](../crop-profiles/carrot.json)).
2. **Live sensor readings:**
   - chamber air (middle of the chamber)
   - the cold air blown off the cooler
   - a probe inside the produce
   - the cooler's hot-side heatsink
   - outside air
   - humidity
   - the cooler's current and voltage (power meter)
   - battery and solar voltage
   - door switch
3. **Fixed safety limits in the firmware.** These protect the Peltier module and the battery,
   and stop the crop from freezing. A wrong profile from the backend cannot override them.

The controller stores the last good profile in flash, so the room keeps running correctly with no
internet. A new or empty room uses the carrot profile.

## What it adjusts, automatically

| Part | Rule |
|---|---|
| **Peltier cooler** (power 0–100 %) | A PI controller sets the power from how far the chamber is above the crop's target (2 °C for carrots), and how long it has been above. Power changes by at most 6 % every 2 s, so the module isn't shocked by sudden changes. Below 15 % the module is either run at 15 % or switched off, because at very low power heat leaks back through it. |
| **Hot-side protection** | Above 55 °C on the hot heatsink, power is reduced step by step. At 65 °C the cooler stops at once. With no hot-side reading, power is capped at 40 %. |
| **Freeze guard** | If the cold air off the cooler drops below the crop's limit (0 °C for carrots), the cooler stops at once. Within 1 °C of the limit, power is not increased. |
| **Frost** | If the cold air is below −3 °C the heatsink is icing up, so power is capped at 30 %. |
| **Hot-side fan** | Runs whenever the cooler runs, for 2 min after it stops, and whenever the hot side is above 40 °C. |
| **Inside fan** | Runs with the cooler, plus 2 min every 15 min to stir the air. Stops while the door is open, and the cooler is then capped at 30 %. |
| **Humidifier** (off by default) | On below 92 % humidity, off above 97 %. At most 5 min at a time so the crops never get wet. Use perforated crate liners first; see carrot.json. |
| **Battery protection** | Below 12.0 V the cooler is limited to 40 %. Below 11.6 V it is off, and only the controller and SMS stay on. Set `HAS_BATTERY false` when the prototype runs from a 12 V mains supply. |
| **Sensor failure** | Without a chamber reading, the cooler runs steadily at 50 %, still within all the limits above, and an alert is sent. |
| **Remote commands** | The platform can change the target (within the crop's safe range), switch cooling OFF or back ON (automatic), and switch the inside and hot-side fans ON or OFF, each for up to 24 h. A fan OFF is honoured only when safe (inside fan while the cooler is not running; hot-side fan while the cooler is stopped and the heatsink is below 40 °C). An optional key switch at the room (`HAS_LOCAL_LOCK`, `PIN_LOCAL_LOCK`) makes the controller refuse remote commands while someone is on site. Each is timed and ends by itself, the controller checks it again, and every limit above still wins. A remote "cooling off" ends early if the chamber reaches the alarm temperature. They are lost on a restart: the room is then fully automatic. |

## How the controller runs

The ESP32 has two cores, and the work is split so that internet problems can never delay cooling:

| Task | Core | Does |
|---|---|---|
| **Control** | 1 | Reads sensors, switches relays, runs the freeze guard, decides alerts. Every 2 s, never waits on the network. |
| **Network** | 0 | Stores readings in flash, uploads them, sends SMS, fetches the crop profile, keeps the clock right, installs firmware updates. |

The control task only drops messages into queues (one reading per minute, SMS texts); the
network task picks them up whenever it can.

### Two roads to the platform: HTTPS (in use) and MQTT (off)
- **HTTPS** is the road in use: readings, the crop profile, commands (in every upload answer and by asking every 15 s), command answers and firmware.
- **MQTT** (`MQTT_ENABLED`, **off** by default; switch it on here and in the platform) stays connected in the background. Commands arrive at once, and when an HTTPS upload fails the same readings go over MQTT. They are deleted from flash only when the platform confirms the batch, and each reading is stored once, so nothing is lost or doubled.
- The room signs in with `DEVICE_ID` (`HHR-001`) and `DEVICE_TOKEN`. Over the internet use TLS (`MQTT_PORT 8883`, `MQTT_TLS true`); `API_ROOT_CA` also checks the MQTT server.

### Offline readings
- Every minute's reading is stored in flash (`record_buffer.cpp`) and survives power cuts.
- When online, readings are sent oldest first, 120 per request, with the time they were recorded.
- The buffer holds about **7 days** (10 000 readings). When full, the oldest are overwritten.
- Sending the same batch twice is safe: the backend stores each reading once.
- So certificates have no gap for an internet outage, only for a real controller outage.

### Clock
Readings carry UTC timestamps. The time comes from, best first:
1. **NTP over Wi-Fi**, kept right in the background.
2. **The 4G network** (NTP through the modem, or the operator's network time).
3. **The DS3231 clock module**, battery-backed, so the time survives power cuts and offline days.

Before the clock is known, readings are stored with "seconds since start" and dated as soon as
the clock is set. Only readings from before a restart with no clock at all are lost. That's the
reason for the DS3231.

### Watchdogs
- **Control loop:** if it stops for 30 s, the ESP32 restarts. Relays start OFF and control resumes within seconds.
- **Network task:** it may wait on the modem, but if it is silent for 10 min the controller restarts.

### Firmware updates (OTA)
- Every 6 h the controller asks the backend for the latest firmware version.
- If it is newer, the controller downloads it, checks the SHA-256 checksum, installs it and restarts.
- The new version is **on probation**: if it crashes or hangs before it has controlled the room
  for 5 min with working sensors, the bootloader goes back to the previous version by itself.
- To publish a version: raise `FW_VERSION` in `config.h`, compile, then on the server run
  `npm run firmware:release -- harvest_hold_controller.ino.bin <version>`.

### Internet: Wi-Fi or 4G
- `NETWORK_MODE`: `NET_WIFI_THEN_CELLULAR` (default), `NET_WIFI_ONLY` or `NET_CELLULAR_ONLY`.
- The SIM7600 modem gives 4G data and sends the SMS alerts. SMS works even when mobile data doesn't.
- Encryption (TLS) runs on the ESP32 for both Wi-Fi and 4G, and checks the server certificate
  against `API_ROOT_CA`. The certificate check needs the right date, which is one more reason for the clock.

## Alerts (SMS + sent to the backend)

The controller sends an alert when:
- the chamber is too warm for 30 min
- the air near the cooler is too cold (crops may freeze)
- the battery is low
- **the hot side is overheating:** check the hot-side fan and heatsink
- **the cooler isn't working:**
  - the power meter sees no current at 50 % power or more, which means a dead module, fuse, wire or MOSFET; or
  - the two sides barely differ in temperature while running hard
- **the cooler can't keep up:** at full power for 1 h and still above target, which means the door seal, too much warm produce, or too hot outside
- the door has been open for more than 3 min
- a sensor is not responding

An unresolved alert is sent again every 2 h. The backend also sends SMS for overheating and
cooler faults, and shows every alert in the app.

## How the backend fits in

```
Farmer adds stock in the app (crop = carrot)
        │
Backend: which crops are in room HHR-001?  → carrot
        │  (if crops that can't share a room are mixed, it warns the farmer instead)
Backend: GET /devices/HHR-001/profile  →  the "controller" block of carrot.json
        │
ESP32: checks the values are safe → saves them → controls with them
        │
ESP32: POST /devices/HHR-001/readings (batches, with timestamps) → app + certificates
```

You don't need AI for this. Crop storage needs are published, measured data, and a lookup table
is more reliable than a model. AI can come later for spotting unusual patterns, such as a
failing pump or a door left open every evening.

## Hardware list (Peltier prototype)

| Item | Notes |
|---|---|
| ESP32 DevKit | Any ESP32-WROOM board with 4 MB flash |
| 1–2 × Peltier module TEC1-12706 (12 V, ~6 A each) | With a large hot-side heatsink and fan, and a cold-side heatsink and fan, mounted with thermal paste. One module suits roughly a 50–100 L well-insulated box |
| Logic-level N-MOSFET (e.g. IRLZ44N) on a heatsink, per ~6 A | Switches the Peltier power with PWM. Put a 10 kΩ pull-down from gate to GND so the cooler stays off while the ESP32 boots. Fuse the Peltier supply (10 A) |
| INA226 power meter module with a 0.01 Ω shunt | In the Peltier supply line. Gives current, voltage, energy and dead-module detection. Set `INA226_SHUNT_OHMS` |
| 5 × DS18B20 waterproof probes | Chamber air, cold air off the cooler, inside produce, **hot-side heatsink**, outside. One wire, 4.7 kΩ pull-up |
| SHT31 (or SHT35/SHT45) humidity sensor | DS18B20s cannot measure humidity |
| 2-channel relay board (or 2 MOSFETs) | Hot-side fan, inside fan (+1 if you add a humidifier) |
| Reed switch + magnet | Door |
| 2 voltage dividers | Battery 47k/10k, panel 100k/10k (check with a multimeter, set the ratio in `config.h`) |
| SIM7600 4G modem (e.g. SIM7600E-H module) + its own 5 V / 2 A supply + LTE antenna | 4G data and SMS. The ESP32's 3.3 V pin cannot power it. Check the module's PWRKEY wiring (`PIN_MODEM_PWRKEY`) |
| Second INA226 + 0.01 Ω shunt on the solar panel wire (optional, `HAS_SOLAR_METER`) | At I2C address 0x41 (bridge A0 to VS). Gives solar generation in watts, so the platform can report kWh generated and the share of use |
| DS3231 clock module with CR2032 battery | I2C, keeps the time through power cuts |
| 16×2 I2C LCD | Door display: chamber temperature, humidity, hot side, cooler power |
| Insulated box | The better the insulation and door seal, the less power the Peltier needs |

### Power budget: read before choosing solar

A Peltier module is not efficient. One TEC1-12706 at full power draws about **70 W**, and the app
shows the real figure under "Energy today". Holding 2 °C on a warm day can mean 0.5–1.5 kWh a day
for one module, which needs a solar panel of several hundred watts and a large battery. For the
first tests, power the prototype from a **12 V / 10 A mains supply** (`HAS_BATTERY false`), and
use the energy readings to size the solar system.

### What a Peltier box can reach

A Peltier module cools to about 15–25 °C below the hot side, depending on the load and the heatsinks.
In Musanze (15–25 °C outside) a small, well-insulated box can reach 2–5 °C, but on warm afternoons
it may not hold 2 °C. The controller then sends the "can't keep up" alert, and the certificates
show the real temperatures. The ice bank is for scaling up for exactly this reason.

## Flashing

1. Install the libraries: OneWire, DallasTemperature, Adafruit SHT31 Library, ArduinoJson 7,
   LiquidCrystal I2C, RTClib, TinyGSM, ArduinoHttpClient, ESP_SSLClient, PubSubClient.
2. Board **ESP32 Dev Module**, partition scheme **Custom**. This uses `partitions.csv`: two
   1.75 MB app slots for updates and 384 KB for offline readings. The firmware is about 1.1 MB.
3. Set `DISCOVERY_MODE true` in `config.h`, flash, and open the Serial Monitor at 115200.
   Copy each DS18B20 address into `config.h`, then set `DISCOVERY_MODE false`.
4. Fill in `config.h`:
   - the Wi-Fi details and/or the SIM's APN
   - `API_HOST`, `DEVICE_ID`, `DEVICE_TOKEN`, `API_ROOT_CA`
   - the alert phone numbers
   - the pins, to match your wiring
5. Flash over USB the first time:
   `arduino-cli compile --upload -p /dev/ttyUSB0 --fqbn esp32:esp32:esp32:PartitionScheme=custom harvest_hold_controller`.
   After that, updates go over the air.

## Changed in version 5

- `DEVICE_ID` is the room's `HHR-001` style id (the old `cr-…` id is still accepted by the platform).
- Remote commands, the MQTT backup, the optional solar meter. The stored reading layout grew by 2 bytes (solar current): **readings still waiting in flash when a controller installs version 5 are not sent.** Install it while the controller is online and its buffer is empty.
- Compiles with `arduino-cli`; **not yet tested on a controller**: do the bench tests below, including a command over each road and a deliberate HTTPS failure.

## Before production: still to do

- [ ] Confirm the carrot numbers with RAB or a postharvest specialist.
- [ ] Tune on the real box: `COOLER_KP` / `COOLER_KI` (smooth temperature, no swinging), the hot-side limits for your heatsink, and the battery limits.
- [ ] Measure a full day's energy use before choosing the solar panel and battery.
- [ ] Put your API's root certificate in `API_ROOT_CA`. With it empty, the device does not check which server it is talking to.
- [ ] Get the APN from the SIM operator and test 4G data and SMS at the cold room site.
- [ ] Test on the bench:
  - pull the internet for a day, then check the readings arrive with the right times
  - pull the power with no internet, then check the DS3231 keeps the time
  - publish a deliberately broken firmware and check it rolls back
- [ ] Bench-test the new roads: send each command type from the portal; block HTTPS only and check the readings arrive over MQTT and leave flash; send a command with the controller offline and check it is dropped after 10 min.
- [ ] Run for 1–2 weeks with an empty room, then with a test batch of carrots, before taking farmers' stock.
