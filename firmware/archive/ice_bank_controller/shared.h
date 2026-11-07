#pragma once
// What the control loop (core 1) and the network task (core 0) share.
// The control loop never waits on the network: it only drops messages into these queues.

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

#include "crop_profile.h"

struct SmsMessage {
  char text[161];
};

extern QueueHandle_t recordQueue;   // Record: control -> network, one per minute
extern QueueHandle_t smsQueue;      // SmsMessage: control -> network
extern QueueHandle_t profileQueue;  // CropProfile: network -> control (length 1, latest wins)
extern SemaphoreHandle_t i2cLock;   // SHT31, DS3231 and LCD share the I2C bus across both tasks

extern volatile uint32_t networkHeartbeat;  // millis() of the network task's last sign of life
extern uint16_t bootCount;

/** Holds the I2C bus for as long as it exists:  { I2cGuard g; sht31.readHumidity(); } */
struct I2cGuard {
  I2cGuard() { xSemaphoreTake(i2cLock, portMAX_DELAY); }
  ~I2cGuard() { xSemaphoreGive(i2cLock); }
};
