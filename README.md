# Harvest Hold Rwanda

Solar-powered cold rooms for smallholder farmers, with a marketplace where buyers can see that a
crop was kept cold, because the room's sensors prove it.

| Folder | What it is |
|---|---|
| `mobile-app/` | Expo (React Native) app for farmers and buyers, in Kinyarwanda, English and French |
| `api/` | NestJS + PostgreSQL server for the app, the controllers (HTTPS and an MQTT backup), the admin portal and the public certificate and batch (QR) pages |
| `admin/` | Next.js staff portal: one dashboard for every cold room, remote control, inventory, collections and charges, energy, farmers and cooperatives, certificates, market, firmware, audit |
| `firmware/` | ESP32 cold room controller (Peltier prototype; ice bank design archived) |
| `crop-profiles/` | Storage rules per crop (carrot first), used by the controller, the API and the app |
| `archive/` | Earlier versions kept for reference; not used |

## Run everything on one computer

```bash
# 1. Database and API
cd api && cp .env.example .env && docker compose up -d && npm install
npm run seed            # demo data
npm run dev             # http://localhost:4000
npm run simulate        # in another terminal: fake controllers sending readings

# 2. Admin portal
cd admin && npm install && npm run dev                      # http://localhost:3000

# 3. Mobile app (phone with Expo Go on the same Wi-Fi)
cd mobile-app && npm install
REACT_NATIVE_PACKAGER_HOSTNAME=<your PC's IP> npx expo start --lan
```

Set `EXPO_PUBLIC_API_URL=http://<your PC's IP>:4000` in `mobile-app/.env.local`. If the firewall is
on, open the ports the phone and other computers need: `sudo ufw allow 4000/tcp` (and `3000/tcp`
to open the portal from another computer).

Demo accounts:

- app, PIN `1234`: farmer `078 812 3456`, buyer `078 865 4321`
- portal superadmin: `admin@harvesthold.rw` / `HarvestHold-dev-2026`; you then choose your own password
- portal cold room operator (sees only Kinigi, HHR-001): `operator@harvesthold.rw` / `HarvestHold-op-2026`
- the demo sensor history is marked **simulated** everywhere it is shown

## One platform, many cold rooms

Every cold room has an id (`HHR-001`, `HHR-002`, ...) given when staff add it in the portal (**Cold rooms → Add cold room**): no new app, no new deployment. Its ESP32 controller uses that id and the token shown once at creation. The controller talks to the platform over **HTTPS**. MQTT is built in but **off** for now (see `api/README.md`); a room keeps cooling and keeps its readings with no link at all.

How produce gets in: a **farmer** asks to store produce in the app (crop and estimated quantity). The **operator** at the cold room weighs and inspects it, confirms the real quantity in **Storage requests** (asked 100 kg, confirmed 95 kg) and registers it: that makes the batch and its QR code, and the farmer sees the confirmed quantity. Storage charge = quantity (kg) × price per kg per day × days; the Super Admin sets the price by crop and by cold room.

Who can do what in the portal: **Super Admin / CEO** everything; **operations** rooms, firmware, crop profiles; **support** accounts; **market** listings and certificates; **cold room operator** only the rooms assigned to them (register produce, record collections, control the room). Farmers and buyers use the mobile app.

## Deploy

```bash
cp .env.production.example .env.production      # fill in every value
docker compose --env-file .env.production up -d --build
docker compose exec api node dist/scripts/create-admin.js you@example.rw "Your Name"
```

This runs PostgreSQL, the API (port 4000) and the portal (port 3000) on localhost. Put a TLS
reverse proxy in front of both. Back up the database, the `data` volume (photos and firmware)
and the certificate signing key. See `api/README.md` for the full production checklist.
