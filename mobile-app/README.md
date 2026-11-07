# Harvest Hold — Mobile App

React Native (Expo SDK 58, Expo Router, TypeScript) app for **farmers** and **buyers**.
The admin web portal is a separate, later project.

## Run it

```bash
npm install
npm start          # then press "a" for Android or scan the QR code with Expo Go
npm run web        # run in the browser
```

## The backend

The app needs the Harvest Hold API (`../backend`). Start it first (see its README), then put its
address in `.env.local`:

```bash
cp .env.example .env.local   # EXPO_PUBLIC_API_URL=http://<your PC's IP>:4000
```

Demo accounts after `npm run seed` in the backend (PIN `1234`): farmer `078 812 3456`, buyer `078 865 4321`.

## Checks

```bash
npm run typecheck
npm test
npm run lint
```

## How it is organised

```
src/
  app/           screens (Expo Router: every file is a route)
    farmer/      farmer tabs: cold room, stock, market, alerts, profile
    buyer/       buyer tabs: browse, orders, alerts, profile
    stock/ listing/ order/ certificate/ cold-room/   shared detail screens
  api/           data layer: HTTP client for the backend API
  features/      larger pieces shared by screens (alerts, profile, order sheet, certificate PDF)
  i18n/          English, Kinyarwanda, French + number/date formatting
  ui/            design system: text, buttons, fields, cards, picker sheet, toast, chart
  theme/         colours, spacing, type scale
```

## Important rules

- **Freshness** comes from the backend, using the room's crop profile (carrots: 0–5 °C, 90–98 % humidity).
  "Kept fresh" while conditions stay in range; "Check quality" after a long excursion; "No data" when the
  cold room stopped reporting for too long. The app never predicts how long a crop will last.
- **Storage time** is set by the server when stock is added: it cannot be back-dated.
- **Certificates** are fixed records issued by the server, with a public check page behind the QR code.
  They are marked *internal* until RSB / NAEB certification exists.
- **Accepting an order** removes that quantity from the listing and from the stored batch.

## Data layer

All data goes through `src/api/index.ts` (HTTP calls to the backend). Errors arrive as
`ApiError(code)`, where `code` matches a key in `errors.*` in the translation files.

## Translations

`src/i18n/locales/en.ts` is the source. `rw.ts` and `fr.ts` must have the same keys; a test checks this.
The Kinyarwanda text should be reviewed by a native speaker before release.
