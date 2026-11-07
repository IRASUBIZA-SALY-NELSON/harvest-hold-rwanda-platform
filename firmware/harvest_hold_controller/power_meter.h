#pragma once
// INA226 power meters (I2C). Tiny driver: no library needed.
//   power::  the Peltier supply line (current, voltage, energy, dead-module check)
//   solar::  the solar panel's wire, optional (HAS_SOLAR_METER): how much the panel generates

#include <Arduino.h>

namespace power {
/** Finds and configures the INA226. False if it is not connected. */
bool begin();
/** Current through the Peltier module(s) in amps, NAN if there is no meter. */
float amps();
/** Supply voltage at the meter in volts, NAN if there is no meter. */
float volts();
}  // namespace power

namespace solar {
bool begin();
/** Current from the solar panel in amps (never negative), NAN if there is no solar meter. */
float amps();
}  // namespace solar
