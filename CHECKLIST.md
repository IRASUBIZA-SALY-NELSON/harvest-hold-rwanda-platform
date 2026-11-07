# Harvest Hold Rwanda — Mobile App Checklist

React Native (Expo) app for **farmers** and **buyers**. Staff use the admin portal (`admin/`, see section 11).

Design rules: mostly white, one green accent from the logo, orange only for warnings, no gradients, few colors.
Freshness rule: the app never predicts how long crops will last. A crop is "Kept fresh" while it is stored and
cold room conditions stay in range.

## 1. Setup
- [x] Expo + TypeScript project in `mobile-app/`
- [x] Expo Router navigation (auth flow, farmer tabs, buyer tabs)
- [x] Logo used for app icon, splash screen and welcome screen
- [x] Theme: colors, spacing, type scale, shared components
- [x] i18n: English, Kinyarwanda, French; language saved on device; switchable anywhere
- [x] Data layer (`src/api`) talking to the API (`api/`)

## 2. Accounts
- [x] Welcome screen with language picker
- [x] Choose account type: farmer or buyer
- [x] Register (farmer: name, phone, district, cold room; buyer: name, phone, business name, business type)
- [x] Sign in with phone number + PIN
- [x] Stay signed in; sign out

## 3. Farmer: cold room monitoring
- [x] Home: cold room status ("Everything is running well" / "too warm" / "too cold"), chamber temperature, humidity
- [x] Ice bank temperature, outside temperature, battery level, solar charging
- [x] Pump, fan and compressor ON/OFF status
- [x] History chart (24 h / 7 days)
- [x] Live refresh

## 4. Farmer: stock (and the central platform, section 13)
- [x] Stock list (crop, quantity, date stored, freshness status)
- [x] Add stock (crop type, quantity, unit, date stored)
- [x] Stock detail with storage conditions since stored

## 5. Freshness certificate
- [x] Certificate per stock batch, based on cold room conditions while stored
- [x] QR code with certificate ID
- [x] Share / save as PDF
- [x] Marked "Internal certificate" (RSB/NAEB approval later)

## 6. Alerts
- [x] Alerts list: chamber too warm, battery low, ice bank low, device offline
- [x] Mark as read / mark all as read
- [x] Unread badge on the tab

## 7. Marketplace: farmer
- [x] List stored crop for sale (price, quantity) from stock
- [x] My listings (on sale / paused / sold out), pause and put back on sale
- [x] Incoming orders: accept / decline
- [x] Stock updates automatically when an order is accepted

## 8. Marketplace: buyer
- [x] Browse listings with search and filters (crop type, district)
- [x] Listing detail: farmer, cold room, freshness status, certificate
- [x] Place an order (quantity, note)
- [x] My orders with status (pending / accepted / declined)
- [x] In-app alerts when an order is accepted, declined or cancelled (push notifications: later)

## 9. Profile & settings
- [x] Profile info
- [x] Language switcher
- [x] Help / contact
- [x] Sign out

## 10. Quality
- [x] TypeScript check passes
- [x] Unit tests: data layer, freshness rules, certificate PDF, translation files have the same keys (38 tests)
- [x] Main flows checked in the browser at phone size: sign in, register, cold room, stock, add stock, certificate, sell, accept order, browse, order, orders, alerts, profile, Kinyarwanda
- [x] Android bundle compiles (`expo export --platform android`) — not run on a device: none connected

## 11. Photos
- [x] Check-in photos (up to 3 per batch): taken while adding stock or later from the batch page; shown on the certificate and its PDF
- [x] Listing photos (up to 4): cover photo on market cards, swipeable gallery and full-screen viewer on the listing
- [x] Profile photo (square crop), shown to buyers on listings
- [x] Downsized on the phone before upload (1600 px JPEG) to save mobile data; failed uploads retry with a tap
- [x] Server refuses non-images, re-encodes as WebP and strips metadata, including the GPS position
- [x] A listing hidden by Harvest Hold shows the farmer why

## 12. Admin portal (`admin/`)
- [x] Staff sign-in: email + password (locks after 5 wrong tries), roles (superadmin, support, operations, market)
- [x] Live overview, cold rooms with health score and minute-by-minute replay, incidents
- [x] Farmers and buyers: unlock, reset PIN, sign out phones, suspend
- [x] Stock, signed certificates (preview, verify, revoke), listings and orders moderation, photos moderation
- [x] Analytics, crop profile editor, firmware channels (beta / stable / halt), staff management
- [x] Hash-chained audit trail of every change, with chain verification


## 13. Central cold-chain platform (the CEO's brief)

Checked against the brief line by line. "Tested" = automated tests or run in the portal against the demo data; the controller firmware is compiled but **not yet tested on a controller**.

### 1. One platform, many rooms
- [x] One web portal and one dashboard for all rooms (Overview, Cold rooms)
- [x] Unique room ids `HHR-001`, `HHR-002`, ... (older rooms renamed once; the old id still works for controllers)
- [x] Administrator monitors and manages every room from the dashboard
- [x] Add a room in the portal: no new application (id and one-time controller token are issued)

### 2. Individual room control
- [x] Each room: its own ESP32, sensors, cooling equipment
- [x] Monitored and shown per room: temperature, humidity, power now (W), energy today, battery % and volts, solar volts and generation (with a solar meter), Peltier duty and module count, hot side, both fans, door
- [x] Remote control by authorised users: target temperature, cooling ON/OFF, inside and hot-side fans ON/OFF (a fan OFF only when safe); timed (up to 24 h), validated, audited, safety limits in the controller always win (tested through the API; firmware not bench-tested)
- [x] On-site control: an optional key switch makes the room refuse remote commands while people are there (`HAS_LOCAL_LOCK`; hardware not built or tested)
- [x] Rooms keep working with no internet (unchanged: control loop on its own core, a week of readings in flash)
- [x] Alerts: high temperature, sensor failure, overheating, low battery, offline device (SMS, app, portal incidents)
- [x] HTTPS is the road in use; MQTT is built and tested but **off by default** (the CEO: add it later, at scale)

### 3. Accounts and permissions
- [x] Super Admin / CEO: all rooms, farmers, inventory, reports, users, settings
- [x] Cold room operator: only the rooms assigned to them (they own none): register produce, manage storage, record collections, control the room (tested: other rooms and every other area are refused)
- [x] Farmer: asks to store produce; the operator weighs it and confirms the real quantity (asked 100 kg, confirmed 95 kg); personal account with stored produce, quantities, storage location, QR code, charges, collection status, storage history
- [x] Buyer: browse listings, contact the seller (call), place orders

### 4. Farmers and traceability
- [x] Register farmers (staff, with a one-time PIN) and cooperatives
- [x] Every batch: farmer, crop, quantity, harvest date, storage location (room and spot)
- [x] Unique batch code and QR code for every batch; the QR opens a public page with the batch's record (no phone numbers)
- [x] Farmers track their produce and its storage history in the app

### 5. Energy and intelligent monitoring
- [x] Electricity, solar generation and battery, where installed (a room without a meter shows a dash, never a made-up zero)
- [x] Energy report and efficiency comparison between rooms (energy per crate per day, power, solar share, battery, how far below outside it is held, time in range), CSV export
- [x] Rule-based alerts and recommendations per room, plus the crop's storage guidance (shown in the portal; not shown in the app yet)
- [x] Simulated data is marked in the database, on every room and batch screen, on certificates and on the public pages

### 6. Inventory and marketplace
- [x] Stock in and out of each room (movement ledger: check-in, collection, sale)
- [x] Available stock across all locations, by room, by crop and batch by batch
- [x] Farmers or authorised operators list produce for buyers
- [x] Orders as before, with a payment status recorded by hand; **a payment provider (mobile money) is not integrated**: only the place for it
- [x] Storage charges = kg × price per kg per day × days (crates also supported); prices by crop and by cold room, set by the Super Admin (most specific wins); collections record who took what and the frozen charge; payments recorded by hand

### 7. Architecture
- [x] Secure IoT connection: MQTT (TLS on the broker or a TLS proxy) next to HTTPS, device id + token
- [x] One central database: users, rooms, readings, commands, alerts, farmers, produce records

### Not done / decisions for later
- [ ] Bench-test the firmware (commands over each road, HTTPS blocked, command expiry)
- [ ] Mobile money payments; **set the storage prices in Settings before the first collection** (nothing is charged until they are set)
- [ ] Physical on-site manual switches wired straight to the equipment (an electrical design decision)
- [ ] Recommendations in the farmer app (they are in the portal)
- [ ] Phone number verification (set aside earlier)
