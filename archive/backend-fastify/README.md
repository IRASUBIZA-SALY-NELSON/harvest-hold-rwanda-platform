# Harvest Hold: backend API

Node.js + TypeScript (Fastify) + PostgreSQL. It serves:

- the **mobile app**: accounts, cold rooms, stock, certificates, marketplace, alerts
- the **ESP32 controllers**: readings upload and crop profile download
- the public **certificate check page**: `/verify/<certificate number>`

## Run it locally

```bash
cp .env.example .env        # then set SECRET (openssl rand -hex 32)
docker compose up -d        # PostgreSQL on 127.0.0.1:5440
npm install
npm run seed                # demo data (wipes the database)
npm run dev                 # API on :4000
npm run simulate            # fake controllers: one reading per room per minute
```

Demo accounts (PIN `1234`): farmer `078 812 3456`, buyer `078 865 4321`.
With `SMS_DRIVER=console`, SMS alerts are printed in the API log.

The phone reaches the API at `http://<your PC's IP>:4000`. If the firewall is on: `sudo ufw allow 4000/tcp`.

## Tests

```bash
npm test          # needs the docker database (uses the harvest_test database)
npm run typecheck
```

## How the rules work

| Rule | Where |
|---|---|
| Each room has a `cooling_type`: `peltier` (prototype) or `ice_bank` (full-size). The app shows the matching equipment, and Peltier rooms get hot-side, cooler-power and energy readings and alerts. Change it with `UPDATE cold_rooms SET cooling_type = ...` | `migrations/004_peltier.sql`, `src/monitor.ts` |
| A room's safe ranges come from its crop profile (`../crop-profiles/<crop>.json`), loaded into the database at every start | `src/crops.ts` |
| Only the room's crop and crops listed as compatible can be checked in | `src/routes/stock.ts` |
| The storage time is set by the server at check-in | `src/routes/stock.ts` |
| Freshness: temperature out of range for longer than the grace period → "attention"; long humidity problems → "attention"; any gap in the data as long as the grace period → "unknown" | `src/freshness.ts` |
| A certificate is a frozen snapshot; issuing again creates a new one. Listing a crop issues one automatically | `src/certificates.ts` |
| Room alerts (too warm, too cold near the coil, too dry, battery, ice, offline) are sent once, plus "back to normal" | `src/monitor.ts` |
| Accounts: PINs stored only as bcrypt hashes (cost 12). After 5 wrong PINs in a row the account is locked until an administrator reactivates it (see below). Phone numbers are not verified for now | `src/routes/auth.ts` |

## Locked accounts and forgotten PINs

Until the administrator tool exists, support staff do this by hand after checking the caller's identity:

```bash
# Reactivate a locked account
psql "$DATABASE_URL" -c "UPDATE users SET locked_at = NULL, failed_pin_attempts = 0 WHERE phone = '+2507XXXXXXXX'"
```

Locking does not sign out phones that are already signed in. It only stops new sign-ins, which
is where guessing happens.

## Controllers

Each cold room has a device token. The server stores only its hash (SHA-256 in `cold_rooms.device_token_hash`).
To set one up for a new room:

```bash
TOKEN=$(openssl rand -hex 24); echo "$TOKEN"     # put this in the firmware's config.h
psql "$DATABASE_URL" -c "UPDATE cold_rooms SET device_token_hash = encode(sha256('$TOKEN'::bytea), 'hex') WHERE id = 'cr-…'"
```

- `POST /devices/:roomId/readings`: the firmware's upload, as `{ readings: [{ t, chamber, … }] }`.
  Each reading carries the controller's own UTC time, so readings kept while offline land at the right time.
  - Readings older than 14 days or in the future are skipped.
  - Duplicates (same room and time) are ignored.
  - Impossible values are stored as null.
  - Only a reading from the last 5 min can raise live alerts.
- `GET /devices/:roomId/profile`: the `controller` block of the room's crop profile.
- `GET /devices/:roomId/firmware` and `/firmware/download`: over-the-air updates.

### Releasing firmware

```bash
npm run firmware:release -- path/to/harvest_hold_controller.ino.bin 4 "what changed"
```

In the production container: `node dist/release-firmware.js <file> <version> "notes"`.
The version must equal `FW_VERSION` in the firmware and be higher than the last release.
Controllers check every 6 h, verify the SHA-256 checksum, and roll back by themselves if the new
version fails. Files are kept in `FIRMWARE_DIR`; keep that folder on persistent storage in production.

## Production checklist

- [ ] Host PostgreSQL with daily backups, and run the API from `Dockerfile` behind HTTPS (`PUBLIC_BASE_URL=https://…`).
- [ ] `SECRET`: a long random value. `NODE_ENV=production` refuses to start without it.
- [ ] SMS: an Africa's Talking account with a sender ID (`SMS_DRIVER=africastalking`, `AT_SANDBOX=false`).
- [ ] Push notifications: build the app with EAS (Expo Go cannot receive them).
- [ ] An admin tool for adding cold rooms, issuing device tokens, reactivating locked accounts and releasing firmware. Until then, use the commands above.
- [ ] Phone number verification (set aside for now).
- [ ] Monitoring: `/health` reports 503 when the database is down.
