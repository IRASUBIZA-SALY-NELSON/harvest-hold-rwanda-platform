#pragma once
// Remote commands from the platform: timed overrides handled by the control loop (core 1).
// The network task (core 0) receives them over HTTPS or MQTT and drops them into commandQueue;
// the control loop answers through ackQueue. Safety limits in the control loop always win.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

enum CommandType : uint8_t { CMD_NONE = 0, CMD_SET_TARGET = 1, CMD_COOLING = 2, CMD_INSIDE_FAN = 3, CMD_HOT_FAN = 4 };

struct RemoteCommand {
  uint32_t id;
  uint8_t type;
  bool backToAuto;   // clear this override
  bool off;          // fans: switch it OFF (instead of ON) for `minutes`
  float targetC;     // CMD_SET_TARGET
  uint16_t minutes;  // how long the override lasts
};

struct CommandAck {
  uint32_t id;
  bool ok;
  char message[48];
};

extern QueueHandle_t commandQueue;  // RemoteCommand: network -> control
extern QueueHandle_t ackQueue;      // CommandAck: control -> network

/** What the control loop is running now, for the platform's "control" panel. Minutes left, 0 = automatic. */
struct ControlSnapshot {
  float targetC;
  uint16_t targetMinutesLeft, coolingOffMinutesLeft, insideFanMinutesLeft, hotFanMinutesLeft, insideFanOffMinutesLeft, hotFanOffMinutesLeft;
  bool localLock;  // the on-site switch is on: remote commands are refused
};
extern volatile ControlSnapshot controlSnapshot;

/**
 * One command as the platform sends it:
 *  {"id":12,"type":"set_target","params":{"targetC":3,"minutes":60},"expiresAt":"..."}
 *  {"id":13,"type":"cooling","params":{"mode":"off","minutes":30},...}   cooling: "off" | "auto" ("on" = auto)
 *  fans: mode "on" | "off" | "auto"
 */
inline bool parseCommand(JsonVariantConst v, RemoteCommand& c) {
  if (!v["id"].is<uint32_t>()) return false;
  c = {};
  c.id = v["id"];
  const char* type = v["type"] | "";
  JsonVariantConst p = v["params"];
  if (!strcmp(type, "set_target")) {
    c.type = CMD_SET_TARGET;
    c.backToAuto = p["targetC"].isNull();
    c.targetC = p["targetC"] | 0.0f;
  } else if (!strcmp(type, "cooling")) {
    c.type = CMD_COOLING;
    c.backToAuto = !strcmp(p["mode"] | "", "auto") || !strcmp(p["mode"] | "", "on");
  } else if (!strcmp(type, "inside_fan")) {
    c.type = CMD_INSIDE_FAN;
    c.backToAuto = !strcmp(p["mode"] | "", "auto");
    c.off = !strcmp(p["mode"] | "", "off");
  } else if (!strcmp(type, "hot_fan")) {
    c.type = CMD_HOT_FAN;
    c.backToAuto = !strcmp(p["mode"] | "", "auto");
    c.off = !strcmp(p["mode"] | "", "off");
  } else {
    return false;
  }
  c.minutes = p["minutes"] | 0;
  return true;
}

/** Puts every command found in a JSON array on the queue (the control loop checks them). */
inline void queueCommands(JsonArrayConst list) {
  for (JsonVariantConst v : list) {
    RemoteCommand c;
    if (parseCommand(v, c)) xQueueSend(commandQueue, &c, 0);
  }
}
