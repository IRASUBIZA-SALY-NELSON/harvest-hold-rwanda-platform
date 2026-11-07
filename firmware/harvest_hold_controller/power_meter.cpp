#include "power_meter.h"

#include <Wire.h>

#include "config.h"
#include "shared.h"

namespace {
/** One INA226 at an I2C address with its shunt resistor. */
struct Meter {
  uint8_t address;
  float shuntOhms;
  bool found = false;

  bool writeReg(uint8_t reg, uint16_t value) {
    Wire.beginTransmission(address);
    Wire.write(reg);
    Wire.write(value >> 8);
    Wire.write(value & 0xFF);
    return Wire.endTransmission() == 0;
  }

  bool readReg(uint8_t reg, uint16_t& value) {
    Wire.beginTransmission(address);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0 || Wire.requestFrom(address, (uint8_t)2) != 2) return false;
    value = (Wire.read() << 8) | Wire.read();
    return true;
  }

  bool begin() {
    I2cGuard g;
    uint16_t id = 0;
    // Manufacturer ID register 0xFE reads "TI" (0x5449) on an INA226.
    if (!readReg(0xFE, id) || id != 0x5449) return false;
    // Continuous shunt + bus measurement, 1.1 ms conversions, average of 16 (a reading every ~35 ms).
    found = writeReg(0x00, 0x4727);
    return found;
  }

  float amps() {
    if (!found) return NAN;
    uint16_t raw;
    {
      I2cGuard g;
      if (!readReg(0x01, raw)) return NAN;
    }
    return (int16_t)raw * 2.5e-6f / shuntOhms;  // shunt voltage: 2.5 µV per bit
  }

  float volts() {
    if (!found) return NAN;
    uint16_t raw;
    {
      I2cGuard g;
      if (!readReg(0x02, raw)) return NAN;
    }
    return raw * 1.25e-3f;  // bus voltage: 1.25 mV per bit
  }
};

Meter cooler{INA226_I2C_ADDRESS, INA226_SHUNT_OHMS};
Meter panel{INA226_SOLAR_I2C_ADDRESS, INA226_SOLAR_SHUNT_OHMS};
}  // namespace

namespace power {
bool begin() { return HAS_POWER_METER && cooler.begin(); }
float amps() { return cooler.amps(); }
float volts() { return cooler.volts(); }
}  // namespace power

namespace solar {
bool begin() { return HAS_SOLAR_METER && panel.begin(); }
float amps() {
  float a = panel.amps();
  return isnan(a) ? NAN : (a < 0 ? 0 : a);  // a small negative reading at night is noise
}
}  // namespace solar
