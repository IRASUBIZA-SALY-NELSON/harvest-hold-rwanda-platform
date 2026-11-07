# Harvest Hold: API

NestJS 12 (Fastify) + TypeScript + PostgreSQL. One server for:

- the **mobile app**: accounts, cold rooms, stock, certificates, marketplace, photos, alerts
- the **ESP32 controllers**: readings upload, crop profile, remote commands and firmware download, over HTTPS or the MQTT backup
- the **admin portal** (`../admin`): everything under `/admin`, staff only
- the public **certificate check page**: `/verify/<certificate number>`

## Run it locally

```bash
cp .env.example .env        # defaults work for development
docker compose up -d        # PostgreSQL on 127.0.0.1:5440
npm install
npm run seed                # demo data (wipes the database)
npm run dev                 # API on :4000, rebuilds on save
npm run simulate            # fake controllers: one reading per room per minute
```

Demo app accounts (PIN `1234`): farmer `078 812 3456`, buyer `078 865 4321`.
Demo portal account: `admin@harvesthold.rw` / `HarvestHold-dev-2026`. The portal then asks you to
choose a new password.
With `SMS_DRIVER=console`, SMS alerts are printed in the API log.

The phone reaches the API at `http://<your PC's IP>:4000`. If the firewall is on: `sudo ufw allow 4000/tcp`.

## Tests

```bash
npm test          # needs the docker database (uses the harvest_test database)
npm run typecheck
```

`swc` compiles (it keeps the decorator metadata Nest needs); `tsc` only checks types.

## Layout

```
src/
  main.ts, bootstrap.ts      start-up: CORS, rate limits, uploads, migrations, crop profiles
  config.ts                  environment and business rules (limits, grace periods)
  common/                    database, errors, guards, validation, CSV
  domain/                    pure logic: freshness, messages, simulation
  modules/
    auth, rooms, stock, market, alerts, devices, verify    the app and the controllers
    crops, monitor, notify, events                          crop profiles, incidents, SMS/push, live events
    certificates                                            issuing and Ed25519 signing
    media                                                   photo upload and serving
    audit                                                   hash-chained audit log
    commands, mqtt                                          remote control of a room; the MQTT broker (backup channel)
    storage, energy, recommendations                        batches, collections and charges; energy reports; what-to-check advice
    admin                                                   the portal's API
  scripts/                   migrate, seed, simulate, release-firmware, create-admin
migrations/                  SQL, applied in order at start-up
```

## How the rules work

| Rule | Where |
|---|---|
| Each room has a `cooling_type`: `peltier` (prototype) or `ice_bank` (full size). Peltier rooms get hot-side, cooler-power and energy readings and alerts | `modules/monitor` |
| A room's safe ranges come from its crop profile (`../crop-profiles/<crop>.json`), loaded at every start. Staff can edit profiles in the portal; edits are checked against the same safety limits as the firmware | `modules/crops` |
| Only the room's crop and compatible crops can be checked in | `modules/stock` |
| The storage time is set by the server at check-in; it cannot be back-dated | `modules/stock` |
| Freshness: temperature out of range longer than the grace period → "attention"; long humidity problems → "attention"; a data gap as long as the grace period → "unknown" | `domain/freshness.ts` |
| A certificate is a frozen snapshot, **signed with Ed25519**. Issuing again creates a new one; staff can revoke one | `modules/certificates` |
| Room problems open an incident (one open incident per room and type) and send alerts once, plus "back to normal" | `modules/monitor` |
| Rooms are `HHR-001`, `HHR-002`, ... An older id is kept as `legacy_id` and still accepted from controllers | `modules/rooms` |
| A remote command is timed, validated against the crop's safe range, audited, and expires if not delivered in 10 min; the controller's safety limits always win | `modules/commands` |
| A reading is `device` (real) or `simulated`; certificates and pages say which they are built on | `modules/devices/ingest.service.ts`, `domain/freshness.ts` |
| A farmer asks to store produce (`POST /storage-requests`); an operator weighs it and confirms the real quantity (`/admin/storage-requests/:id/accept`), which creates the batch. Farmers cannot record stock themselves | `modules/stock`, `modules/storage` |
| Storage charge = quantity × days × the price in force, most specific first: crop in a room, crop everywhere, the room's price, the system price (`/admin/prices`, `/admin/settings`). The day produce comes in and the day it leaves both count; the charge is frozen when the collection is recorded. No rate set = "no rate", never 0 | `modules/storage` |
| Produce leaves a room only through a recorded collection or an accepted market order; both write a stock movement | `modules/storage` |
| A cold room operator reaches only routes that name them, and only their assigned rooms (fail closed) | `modules/admin/admin.guard.ts` |

## Security

- **App accounts.** PINs are stored only as bcrypt hashes (cost 12). After 5 wrong PINs in a row the
  account is locked until a staff member unlocks it in the portal. Staff can also reset a PIN,
  sign a person out of every phone, or suspend the account. Phone numbers are not verified for now.
- **Staff accounts.** Email + password (at least 12 characters, letters and digits, bcrypt).
  A temporary password must be changed at first sign-in. 5 wrong passwords in a row lock the
  account until a superadmin unlocks it; sign-in is also rate-limited. Roles: superadmin, support, operations, market. The last superadmin cannot be removed.
- **Portal sessions** live in an httpOnly, SameSite=Strict cookie on the portal's own server, which
  forwards requests here; the browser never sees the token. Every change needs a custom header (CSRF).
- **Audit trail.** Every change made by staff, app users or the system is written to `audit_log`
  with before/after values. Each entry stores the hash of the previous one; a database trigger
  refuses UPDATE and DELETE. "Verify chain" in the portal recomputes the hashes and finds any edit.
- **Certificates.** Signed over a canonical JSON form. The public key is published at
  `/.well-known/harvest-hold-certificates.pem`, so anyone can check a certificate without trusting
  this server. The verify page reports a broken signature or a revoked certificate.
- **Photos.** Uploads are decoded with sharp, so files that are not real images are refused.
  Photos are then rotated upright, resized to at most 1600 px, re-encoded as WebP, and stripped of
  all metadata, including the GPS position. Limits: 12 MB per upload, 4 per listing, 3 per batch,
  1 profile photo. Staff can remove any photo; removed files are deleted after 30 days.

## Photos

| Call | What it does |
|---|---|
| `POST /photos` (multipart: `kind`, `entityId`, `file`) | `kind` is `listing`, `checkin` (a batch) or `profile`. Only the owner can add photos |
| `DELETE /photos/:id` | The owner removes a photo |
| `GET /media/:id` and `?size=thumb` | The WebP file (480 px for the thumbnail). Ids are random, so links cannot be guessed |

Files are stored in `UPLOADS_DIR`. Keep it on persistent storage and back it up.

## Controllers

Each cold room has an id (`HHR-001`) and a device token; the server stores only the token's SHA-256. Create rooms and issue or
rotate tokens in the portal (**Cold rooms → Settings**). The token is shown once.

- `POST /devices/:roomId/readings`: the firmware's upload, `{ readings: [{ t, chamber, … }] }`.
  Each reading carries the controller's UTC time, so readings kept while offline land at the right time.
  Readings older than 14 days or in the future are skipped; duplicates are ignored; impossible
  values are stored as null. Only a reading from the last 5 min can raise live alerts.
- `GET /devices/:roomId/commands` and `POST /devices/:roomId/commands/:id/ack`: remote commands waiting for the room, and the room's answer. The answer to a readings upload also carries the waiting commands.
- `GET /devices/:roomId/profile`: the `controller` block of the room's crop profile.
- `GET /devices/:roomId/firmware` and `/firmware/download`: over-the-air updates for the room's channel.

### MQTT: a second road (off by default)

HTTPS is the road in use. The API can also run an MQTT broker (Aedes), switched on with `MQTT_ENABLED=true` (and `MQTT_ENABLED`/`MQTT_*` in the controller's `config.h`) when there are more rooms or commands should arrive at once:

| Topic | Direction | Content |
|---|---|---|
| `hhr/<id>/up/readings` | room → platform | the same JSON as the HTTPS upload, plus `batch` (a number). The platform answers on `down/stored` |
| `hhr/<id>/up/ack` | room → platform | `{ id, ok, message }` for a command |
| `hhr/<id>/up/hello` | room → platform | on connect: the platform sends any waiting commands |
| `hhr/<id>/down/command` | platform → room | `{ id, type, params, expiresAt }`, sent at once |
| `hhr/<id>/down/stored` | platform → room | `{ batch, accepted, duplicates, skipped }`: the room may now delete those readings from flash |

A controller signs in with its room id and device token and can only use topics under its own id. The controller sends readings over HTTPS first and over MQTT only when HTTPS fails; each reading is stored once either way. Settings: `MQTT_ENABLED` (default **false**), `MQTT_PORT` (1883), `MQTT_TLS_PORT` + `MQTT_TLS_CERT` + `MQTT_TLS_KEY` for TLS, `MQTT_ALLOW_PLAIN`. Over the internet use TLS: either give the API a certificate, or put a TLS proxy on port 8883 in front of port 1883 (the production `docker-compose.yml` publishes 1883 on localhost for that).

### Remote control

`POST /admin/rooms/:id/commands` `{ type, params, reason }` for operations staff and the room's operators:

| type | params | limits |
|---|---|---|
| `set_target` | `{ targetC, minutes }` or `{ targetC: null }` | the crop's alarm limits minus 0.5 °C and above the freeze guard; up to 24 h |
| `cooling` | `{ mode: "off", minutes }`, or `{ mode: "on" }` / `{ mode: "auto" }` to hand it back to the thermostat | up to 24 h; the room resumes cooling by itself at its alarm temperature |
| `inside_fan`, `hot_fan` | `{ mode: "on" \| "off", minutes }` or `{ mode: "auto" }` | up to 24 h. A fan OFF is honoured only when safe: the inside fan while the cooler is not running, the hot-side fan while the cooler is stopped and the heatsink is below 40 °C |

An optional key switch at the room (`HAS_LOCAL_LOCK`) makes the controller refuse remote commands while someone is on site.

Every command is in the audit trail (who, why) and ends by itself.

### Releasing firmware

Upload a release in the portal (**Firmware**) to the `beta` channel, watch the beta rooms, then
promote it to `stable`. "Halt" stops a bad release from being offered. Or from the command line:

```bash
npm run firmware:release -- path/to/harvest_hold_controller.ino.bin 4 "what changed"
```

The version must equal `FW_VERSION` in the firmware and be higher than the last release.
Controllers check every 6 h, verify the SHA-256 checksum, and roll back by themselves if the new
version fails.

## Staff accounts

Roles: `superadmin` (Super Admin / CEO), `support`, `operations`, `market` and `operator`. A **cold room operator** is not tied to rooms of their own: a superadmin assigns the rooms they work in (**Staff → Assign rooms**), and they see and act on those only.

```bash
npm run admin:create -- name@example.rw "Full Name"
```

Creates a superadmin and prints a temporary password; the person chooses their own at first sign-in.
After that, superadmins add staff in the portal (**Staff**).

Forgotten password or locked out, and no other superadmin to reset you in the portal:

```bash
npm run admin:reset -- name@example.rw
```

Prints a new temporary password, to be changed at the next sign-in.

## Production

Build and run everything with the `docker-compose.yml` at the project root (see the root README).

- [ ] PostgreSQL with daily backups; `/data` (photos, firmware) on persistent storage and backed up.
- [ ] HTTPS in front of the API and the portal (`PUBLIC_BASE_URL`, `ADMIN_ORIGIN` are `https://…`).
- [ ] `SECRET`: at least 32 random characters. `NODE_ENV=production` refuses to start without it.
- [ ] `CERT_SIGNING_KEY`: an Ed25519 private key, created once and backed up. Required in production.
- [ ] SMS: an Africa's Talking account with a sender ID (`SMS_DRIVER=africastalking`, `AT_SANDBOX=false`).
- [ ] Push notifications: build the app with EAS (Expo Go cannot receive them).
- [ ] Phone number verification (set aside for now).
- [ ] MQTT: a TLS proxy on port 8883 forwarding to `127.0.0.1:1883` (or `MQTT_TLS_CERT` and `MQTT_TLS_KEY`), and the port open in the firewall.
- [ ] Storage rates set in the portal (**Settings**): until then charges show "no rate set".
- [ ] Monitoring: `/health` reports 503 when the database is down.
