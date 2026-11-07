# Harvest Hold: admin portal

Next.js 16 (App Router) + React 19 + Tailwind CSS 4. The staff portal for running Harvest Hold:
cold rooms and their controllers, farmers and buyers, stock, certificates, the market, photos,
crop profiles, firmware, analytics, staff and the audit trail. Everything updates live.

## Run it locally

The API must be running (`../api`, `npm run dev`).

```bash
npm install
npm run dev        # http://localhost:3000
```

Sign in with the demo account `admin@harvesthold.rw` / `HarvestHold-dev-2026` (created by the API's
`npm run seed`). The first sign-in asks you to choose your own password.

`.env.local`:

| Variable | What it is |
|---|---|
| `ADMIN_API_URL` | Where this server reaches the API, e.g. `http://127.0.0.1:4000`. Server-side only |
| `NEXT_PUBLIC_PUBLIC_API_URL` | The API's public address, used for certificate verify links and QR codes |

## How it is put together

- **The browser never holds the API token.** `src/app/api/admin/[...path]/route.ts` forwards
  every request to the API's `/admin` routes. The session token is kept in an httpOnly,
  `SameSite=Strict` cookie; every change must carry the `x-hh-request` header, which a
  cross-site form cannot send. Responses stream through, so the live feed (server-sent events) works.
- **`src/proxy.ts`** sends anyone without a session to `/login`.
- **Live updates.** `src/lib/live.tsx` keeps one event stream open (readings, incidents, orders,
  sign-ups…). Pages refresh what they show when a relevant event arrives.
- **Roles.** The API enforces them; the portal only hides what a role cannot use
  (`useCan()` in `src/components/admin-context.tsx`).

| Role | Can |
|---|---|
| Superadmin | Everything, including staff accounts |
| Support | Farmers and buyers: unlock, reset PIN, sign out phones, suspend. Incidents |
| Operations | Cold rooms, controllers, device tokens, firmware, crop profiles, incidents |
| Market | Listings, orders, certificates (revoke), photos |

## Pages

| Page | What it is for |
|---|---|
| Overview | Fleet health, open incidents, today's numbers, the live activity feed |
| Cold rooms | Every room with a health score (each factor explained). A room page shows live state and a minute-by-minute replay with incidents marked, history charts, stock and farmers, incident timeline, settings (location, crop, firmware channel, device token) |
| Incidents | Every room problem from start to end. Staff acknowledge one with a note saying what they did; it closes by itself when the room is back to normal |
| Farmers & buyers | Search and filter; a person's page shows stock, listings, orders, certificates, alerts and their audit history, with unlock, PIN reset, sign-out and suspend |
| Stock | Every batch with its freshness recalculated from the sensor records |
| Certificates | Preview exactly as issued, signature check, QR code, print, revoke |
| Listings & orders | Hide a listing with a reason (the farmer sees it); order history |
| Photos | Every uploaded photo; remove or restore |
| Analytics | Time in the safe range, cooler energy, check-ins, sales, prices, districts, top farmers; every chart has a table view |
| Crop profiles | Edit storage rules with a review step that shows what changes; unsafe values are refused |
| Firmware | Upload to beta, promote to stable, halt; rollout per version |
| Audit trail | Who changed what, when, from where, with before/after values; verify the hash chain |
| Staff | Add staff, change roles, unlock, reset access |
| Your account | Change password, signed-in sessions |

Press <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere to search people, rooms, certificates and batches.

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Production

Built by `admin/Dockerfile` (standalone Next.js server), run by the root `docker-compose.yml`.
Serve it over HTTPS only, and set the API's `ADMIN_ORIGIN` to the portal's address.
