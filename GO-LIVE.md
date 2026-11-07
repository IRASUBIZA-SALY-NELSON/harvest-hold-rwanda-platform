# Harvest Hold Rwanda: go-live checklist

Do these in order. Each step says how to know it worked. Tick them as you go.

## 0. Before anything

- [ ] **Back up the current production database** (if one exists): `pg_dump` to a file kept off the server. Migration 008 renames the existing cold rooms to `HHR-001`, `HHR-002`, ... and backfills stock history; it was tested on demo data, not on yours.
- [ ] Check that no secrets are in what you push: `.env`, `.env.production`, `*.pem`, `api/keys/`, `*.apk`. The root `.gitignore` excludes them; confirm with `git status` before the first push.
- [ ] Never run `npm run seed` on the server (it wipes the database, and refuses to run in production).

## 1. The server (database, API, portal)

You need one Linux server with Docker, a domain, and a TLS reverse proxy (Caddy or nginx).

- [ ] Point two names at the server: the API (e.g. `api.harvesthold.rw`) and the portal (e.g. `admin.harvesthold.rw`).
- [ ] `cp .env.production.example .env.production` and fill **every** value:
  - `DB_PASSWORD`: a long random password.
  - `SECRET`: `openssl rand -hex 32`.
  - `CERT_SIGNING_KEY`: created **once**, see below. Losing it means old certificates can no longer be verified, so back it up.
  - `PUBLIC_API_URL` and `ADMIN_URL`: the two `https://` addresses.
  - `SMS_DRIVER=africastalking` with `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`, and `AT_SANDBOX=false` (alerts to farmers and operators are sent by SMS; the API refuses to start in production with `SMS_DRIVER=console`).
  - `MQTT_ENABLED=false` (leave it off: HTTPS is in use).
- [ ] Create the signing key on one line and paste it as `CERT_SIGNING_KEY`:
  ```bash
  openssl genpkey -algorithm ed25519 | awk 'BEGIN{ORS="\\n"}1'
  ```
- [ ] Start everything:
  ```bash
  docker compose --env-file .env.production up -d --build
  ```
- [ ] Put the TLS proxy in front: API name → `127.0.0.1:4000`, portal name → `127.0.0.1:3000`. Both must be served over HTTPS.
- [ ] **Check:** `https://<api>/health` answers `{"ok":true}`; `https://<portal>/login` shows the sign-in page.
- [ ] **Backups** (set up now, not later): the database daily; the Docker volume `data` (photos and firmware files); `.env.production`; the certificate signing key.

## 2. The first administrator

- [ ] Create the Super Admin (prints a temporary password once):
  ```bash
  docker compose exec api node dist/scripts/create-admin.js you@example.rw "Your Name"
  ```
- [ ] Sign in to the portal, choose your own password (at least 12 characters, letters and digits).
- [ ] In **Staff**, add the other people: the CEO as Super Admin, and each **cold room operator** (then **Assign rooms**). Give each person the temporary password in person or by phone, not by email.
- [ ] If you are ever locked out and no other Super Admin exists: `docker compose exec api node dist/scripts/reset-admin.js you@example.rw`.

## 3. Set up the business data in the portal

- [ ] **Settings → Storage price**: the default RWF per kg per day. Then **Prices by crop and cold room** for each crop (and room where different). Until a price exists, charges show "no rate". Do this **before the first collection**.
- [ ] **Crop profiles**: confirm the carrot numbers with RAB or a postharvest specialist (the file says "draft"). The controller's targets and the safe ranges come from here.
- [ ] **Cold rooms → Add cold room** for each room (name, district, sector, crop, capacity, number of Peltier modules). The portal shows the room id (`HHR-001`) and the **controller token once**: copy it into the room's `config.h` right away.
- [ ] **Farmers & cooperatives**: register the cooperatives; farmers can then register themselves in the app, or an operator registers them (a one-time PIN is shown once).

## 4. The controllers (ESP32), room by room

The firmware compiles but **has not been run on a controller yet**. Bench-test before a room depends on it.

- [ ] Install the libraries (`firmware/README.md`, "Flashing"), board **ESP32 Dev Module**, partition scheme **Custom**.
- [ ] In `config.h` set: `DEVICE_ID` (`HHR-001`), `DEVICE_TOKEN` (from the portal), `API_HOST` (the API name), `API_ROOT_CA` (your API's root certificate: with it empty the controller does not check which server it talks to), Wi-Fi and/or the SIM's APN, alert phone numbers, pins, and the DS18B20 sensor addresses (use `DISCOVERY_MODE` once). Keep `MQTT_ENABLED false`.
- [ ] Flash over USB the first time. Later updates go over the air from **Firmware** in the portal (upload to the beta channel, watch, then promote).
- [ ] **Bench tests** (on the bench, no crop):
  - [ ] The room appears **Online** in the portal within a minute, with the right temperatures, power in watts, battery and fans.
  - [ ] Pull the internet for a day: readings arrive afterwards with the right times.
  - [ ] Send each remote command from the portal (target, cooling OFF/ON, each fan ON/OFF) and see it carried out; check a fan OFF is refused while the cooler runs.
  - [ ] Hot side overheating and freeze guard stop the cooler (use the checks in `firmware/README.md`).
  - [ ] Publish a deliberately broken firmware and check it rolls back.
- [ ] Run 1–2 weeks with an empty room, then with a test batch, before taking farmers' produce. Measure a full day's energy before choosing the solar panel and battery.
- [ ] Installing firmware v5 over an older version: do it while the controller is online (readings waiting in flash at that moment are not sent).

## 5. The mobile app

The app has no EAS configuration yet, and `HarvestHold.apk` is an old build. Make a new one with your Expo account.

- [ ] `cd mobile-app`, then `npx eas-cli login` and `npx eas-cli build:configure` (creates `eas.json`).
- [ ] Set the production API address for the build: `EXPO_PUBLIC_API_URL=https://<api>` (in `eas.json` under the production profile's `env`). **Not** the development address.
- [ ] Build: `npx eas-cli build --platform android --profile production`. Push notifications only work in this kind of build, not in Expo Go.
- [ ] Install the new build on a phone and test with a real farmer account: register (or be registered by an operator), **Request storage**, have the operator confirm it in the portal, see the confirmed quantity, charges, QR code and collection request; as a buyer, browse, call a seller, order.
- [ ] Remove the old `HarvestHold.apk` from the project folder.

## 6. First day with real users

- [ ] A farmer registers (or an operator registers them) and asks to store produce; an operator weighs it in **Storage requests**, writes the confirmed quantity and the spot in the room, and prints the QR label from the batch page.
- [ ] The farmer sees the confirmed quantity in the app and is notified.
- [ ] Collection: the operator records who collected and how much; the storage charge is fixed at that moment and shows in **Collections & charges**. Record payments there (cash, mobile money, bank) by hand: there is no mobile money integration yet.
- [ ] Watch **Incidents** and the live overview for the first days; check SMS alerts really arrive on the operators' phones.

## 7. Later (not needed for go-live)

- [ ] MQTT: switch on (`MQTT_ENABLED=true` here and in `config.h`) when there are many rooms; put a TLS proxy on port 8883 forwarding to `127.0.0.1:1883`.
- [ ] Mobile money payments.
- [ ] Physical on-site manual switches wired directly to the equipment (an electrical design for the CEO), and the optional key switch (`HAS_LOCAL_LOCK`).
- [ ] Phone number verification.
