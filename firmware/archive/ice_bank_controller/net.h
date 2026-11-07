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
/** Downloads and installs newer firmware if the backend has one, then restarts. */
void checkForUpdate();
}  // namespace net
