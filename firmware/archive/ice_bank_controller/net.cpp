#define TINY_GSM_MODEM_SIM7600
#define TINY_GSM_RX_BUFFER 1024

#include "net.h"

#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <ESP_SSLClient.h>
#include <TinyGsmClient.h>
#include <Update.h>
#include <WiFi.h>
#include <mbedtls/sha256.h>

#include "clock.h"
#include "config.h"
#include "shared.h"

namespace {
HardwareSerial modemSerial(2);
TinyGsm modem(modemSerial);
TinyGsmClient gsmClient(modem, 0);
WiFiClient wifiClient;
// TLS done on the ESP32 itself (BearSSL), the same way over Wi-Fi and 4G: the SIM7600's own
// TLS is not supported by TinyGSM, and this way the server certificate is always checked here.
ESP_SSLClient tls;
net::Link current = net::LINK_NONE;
bool modemReady = false;
uint32_t lastModemAttempt = 0;

void alive() { networkHeartbeat = millis(); }

bool wifiAllowed() { return NETWORK_MODE != NET_CELLULAR_ONLY; }

bool connectWifi() {
  if (!wifiAllowed()) return false;
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(500);  // auto-reconnect runs in the background
  return WiFi.status() == WL_CONNECTED;
}

bool startModem() {
  if (modemReady) return true;
  if (!HAS_MODEM) return false;
  if (lastModemAttempt && millis() - lastModemAttempt < 60000UL) return false;  // don't hammer a dead modem
  lastModemAttempt = millis();
  modemSerial.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  if (!modem.testAT(2000)) {
    // Not answering: press the power key (pulse), then give it time to boot.
    pinMode(PIN_MODEM_PWRKEY, OUTPUT);
    digitalWrite(PIN_MODEM_PWRKEY, HIGH);
    delay(600);
    digitalWrite(PIN_MODEM_PWRKEY, LOW);
    alive();
    if (!modem.testAT(25000)) {
      Serial.println("4G modem: no answer");
      return false;
    }
  }
  alive();
  if (!modem.init(strlen(SIM_PIN) ? SIM_PIN : nullptr)) {
    Serial.println("4G modem: init failed (SIM?)");
    return false;
  }
  modemReady = true;
  return true;
}

bool connectCellular() {
  if (!startModem()) return false;
  if (modem.isGprsConnected()) return true;
  alive();
  if (!modem.isNetworkConnected() && !modem.waitForNetwork(60000L)) {
    Serial.println("4G: no network");
    return false;
  }
  alive();
  if (!modem.gprsConnect(CELL_APN, CELL_USER, CELL_PASSWORD)) {
    Serial.println("4G: data connection failed (APN?)");
    return false;
  }
  alive();
  return modem.isGprsConnected();
}

void use(net::Link l) {
  if (l == current) return;
  tls.stop();
  if (l != net::LINK_NONE) tls.setClient(l == net::LINK_WIFI ? static_cast<Client*>(&wifiClient) : static_cast<Client*>(&gsmClient), API_TLS);
  current = l;
  Serial.printf("internet: %s\n", net::linkName());
}

bool clockNeededForTls() { return API_TLS && strlen(API_ROOT_CA) > 0 && !clk::valid(); }

/** Starts a request; the caller reads the response. Returns 0 when the request was sent. */
int startRequest(HttpClient& http, const char* method, const char* path, const String& body) {
  http.setHttpResponseTimeout(20000);
  http.beginRequest();
  int err = strcmp(method, "POST") == 0 ? http.post(path) : http.get(path);
  if (err != 0) return err;
  http.sendHeader("Authorization", "Bearer " DEVICE_TOKEN);
  http.sendHeader("X-Firmware-Version", FW_VERSION);
  if (body.length()) {
    http.sendHeader("Content-Type", "application/json");
    http.sendHeader("Content-Length", body.length());
    http.beginBody();
    http.print(body);
  }
  http.endRequest();
  return 0;
}
}  // namespace

namespace net {

void begin() {
  if (strlen(API_ROOT_CA)) tls.setCACert(API_ROOT_CA);
  else tls.setInsecure();  // testing only: encrypted, but the server is not verified
  tls.setBufferSizes(16384, 2048);  // TLS records can be 16 KB (firmware downloads)
  tls.setTimeout(20000);
  if (wifiAllowed()) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

bool connect() {
  if (connectWifi()) {
    use(LINK_WIFI);
    clk::startNtp();
    return true;
  }
  if (connectCellular()) {
    use(LINK_CELLULAR);
    return true;
  }
  use(LINK_NONE);
  return false;
}

Link link() { return current; }
const char* linkName() { return current == LINK_WIFI ? "Wi-Fi" : current == LINK_CELLULAR ? "4G" : "none"; }

int request(const char* method, const char* path, const String& body, String* response) {
  if (!connect()) return -1;
  if (clockNeededForTls()) syncClock();  // certificates can only be checked with the right date
  if (clockNeededForTls()) return -3;
  alive();
  HttpClient http(tls, API_HOST, API_PORT);
  if (startRequest(http, method, path, body) != 0) {
    http.stop();
    return -2;
  }
  int status = http.responseStatusCode();
  if (status > 0 && response) *response = http.responseBody();
  http.stop();
  alive();
  return status;
}

bool sendSms(const char* phone, const char* text) {
  if (!HAS_MODEM || !phone || !strlen(phone) || !startModem()) return false;
  alive();
  if (!modem.isNetworkConnected() && !modem.waitForNetwork(30000L)) return false;
  bool ok = modem.sendSMS(phone, text);
  alive();
  return ok;
}

void syncClock() {
  if (current == LINK_WIFI) {
    clk::startNtp();
    for (int i = 0; i < 20 && !clk::valid(); i++) delay(500);
    return;
  }
  if (!HAS_MODEM || !startModem()) return;
  alive();
  if (current == LINK_CELLULAR) modem.NTPServerSync(NTP_SERVER, 0);  // corrects the modem's clock over the data link
  int y, mo, d, h, mi, s;
  float tz;
  if (modem.getNetworkTime(&y, &mo, &d, &h, &mi, &s, &tz)) {  // local time + its offset from UTC in hours
    struct tm t = {};
    t.tm_year = y - 1900;
    t.tm_mon = mo - 1;
    t.tm_mday = d;
    t.tm_hour = h;
    t.tm_min = mi;
    t.tm_sec = s;
    // TZ is UTC, so mktime treats the fields as UTC; subtract the network's offset to get real UTC.
    clk::set((uint32_t)(mktime(&t) - (time_t)lroundf(tz * 3600)), "4G network");
  }
  alive();
}

void checkForUpdate() {
  String info;
  if (request("GET", "/devices/" DEVICE_ID "/firmware", "", &info) != 200) return;  // 204: nothing newer
  JsonDocument doc;
  if (deserializeJson(doc, info)) return;
  int version = doc["version"] | 0;
  uint32_t size = doc["size"] | 0;
  String expected = doc["sha256"] | "";
  if (version <= FW_VERSION || size == 0 || expected.length() != 64) return;
  Serial.printf("firmware %d available (%u bytes), downloading\n", version, (unsigned)size);

  HttpClient http(tls, API_HOST, API_PORT);
  if (startRequest(http, "GET", "/devices/" DEVICE_ID "/firmware/download", "") != 0 || http.responseStatusCode() != 200) {
    http.stop();
    return;
  }
  http.skipResponseHeaders();
  if ((uint32_t)http.contentLength() != size || !Update.begin(size)) {
    Serial.println("firmware: size mismatch or no room");
    http.stop();
    return;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  static uint8_t buf[1024];
  uint32_t done = 0, lastData = millis();
  while (done < size && millis() - lastData < 30000UL) {
    int n = http.read(buf, min<uint32_t>(sizeof buf, size - done));
    if (n > 0) {
      if (Update.write(buf, n) != (size_t)n) break;
      mbedtls_sha256_update(&sha, buf, n);
      done += n;
      lastData = millis();
      alive();
    } else {
      delay(5);
    }
  }
  http.stop();

  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", digest[i]);

  // Install only a complete download with the exact checksum the server announced.
  if (done != size || !expected.equalsIgnoreCase(hex)) {
    Update.abort();
    Serial.println("firmware: download incomplete or corrupted, not installed");
    return;
  }
  if (!Update.end(true)) {
    Serial.printf("firmware: install failed (%s)\n", Update.errorString());
    return;
  }
  Serial.println("firmware installed, restarting");
  delay(500);
  ESP.restart();
}

}  // namespace net
