#pragma once
// Internet for the controller: Wi-Fi or a SIM7600 4G modem, encrypted HTTPS to the backend,
// SMS through the modem, and firmware updates. Used only by the network task, so the control
// loop never waits on it.

#include <Arduino.h>

namespace net {
enum Link : uint8_t { LINK_NONE, LINK_WIFI, LINK_CELLULAR };

void begin();
/** Makes sure there is a working internet link (Wi-Fi first, then 4G). Can take about a minute on 4G. */
bool connect();
Link link();
const char* linkName();
/** HTTPS request to the backend. Returns the HTTP status, or a negative number when there is no connection. */
int request(const char* method, const char* path, const String& body, String* response);
/** SMS through the 4G modem (works without a data connection). */
bool sendSms(const char* phone, const char* text);
/** Sets the clock from NTP (Wi-Fi) or from the 4G network. */
void syncClock();

// ---- MQTT backup channel (see MQTT_* in config.h). Topics: hhr/<id>/up/<kind> and hhr/<id>/down/<kind>.
/** Called for every message from the platform: `kind` is the part after hhr/<id>/down/ (e.g. "command"). */
typedef void (*MqttHandler)(const char* kind, const uint8_t* payload, unsigned length);
void mqttBegin(MqttHandler handler);
/** Keeps the MQTT connection up (connects, answers pings, delivers incoming messages). Call about once a second. */
void mqttMaintain();
bool mqttConnected();
/** Publishes to hhr/<id>/up/<kind>. False when MQTT is not connected. */
bool mqttPublish(const char* kind, const String& body);
/** Downloads and installs newer firmware if the backend has one, then restarts. */
void checkForUpdate();
}  // namespace net
