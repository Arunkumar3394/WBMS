# AquaPure Water

Website for **AquaPure Water**: customers order 20-litre water cans and packaged drinking water online, choose a delivery slot, and pay on delivery or online with Razorpay. Staff and admins run orders, deliveries, stock, customers and settings from a dashboard.

> Setting it up for the first time? Follow **[SETUP.md](SETUP.md)** step by step.

## What it does

**Customers**
- Browse products by category, see prices (sample prices are labelled), add to cart.
- Register and sign in with email and password; save delivery addresses.
- Check out: pick an address, delivery date and time slot. The server works out the delivery charge for the pincode, any refundable can deposit, and the total.
- Pay **cash / UPI on delivery** or **online with Razorpay**.
- See order history and track each order: Placed → Confirmed → Out for delivery → Delivered (or Cancelled). Cancel while it is still pending. Pay later if an online payment was not completed.
- Contact form and bulk-order / monthly-supply enquiries; WhatsApp and phone buttons once the numbers are set.

**Staff** (orders, customers, enquiries, reports)
- Dashboard with today's numbers. Order list with filters and CSV export.
- Confirm, send out and mark orders delivered (with can counts), record cash received, cancel, keep staff notes, print a delivery slip.
- Customer details, addresses, orders and can-deposit history. Enquiries with status and notes. Sales report by day and product.

**Admins** (everything above, plus)
- Products: prices, sample-price flag, stock with history, images (uploaded to Supabase Storage), shown / hidden.
- Categories, delivery zones (pincodes, charges, free-delivery and minimum-order amounts), delivery slots (times, capacity, days, booking cut-off).
- Settings: cash on delivery, online payment, can deposits, closed dates, booking window. Reviews. Staff and admin access.

## How it fits together

```
Browser (Angular 20)  ──sign in──▶  Supabase Auth (email + password)
        │
        │  every data request, with the Supabase access token
        ▼
AquaPure API (.NET Framework 4.8)  ──checks the token, then connects as the low-privilege
        │                              "wbms_api" role with the user's identity set,
        │                              so Row Level Security applies to every query
        ▼
Supabase Postgres (schema "app", not exposed to the public Data API)
        ▲
        └── Razorpay: the API creates the order, checks the signature, asks Razorpay
            for the payment, and the database records it once. A webhook covers
            customers who close the page.
```

- **Prices are never trusted from the browser.** The browser sends product ids and quantities; the database prices everything (`app.quote_order`, `app.place_order`).
- **Roles are enforced twice**: by the API (`[Require(Access.Admin)]` etc.) and by the database (RLS policies and `require_admin()` / `require_staff()` in every function). Hiding menu items is only for convenience.
- **No service-role key is used anywhere.** Razorpay secrets and the database password live only on the API server.

## Technology

| Part | Technology | Folder |
|---|---|---|
| Website | Angular 20 (standalone components, signals), Tailwind CSS 4, TypeScript | [web/](web/) |
| API | ASP.NET Web API 2 on .NET Framework 4.8, self-hosted with OWIN; Npgsql + Dapper | [api/](api/) |
| Database, sign-in, images | Supabase (Postgres, Auth, Storage), Row Level Security | [database/](database/) |
| Payments | Razorpay Checkout + Orders API + webhooks | [api/AquaPure.Api/Payments/](api/AquaPure.Api/Payments/) |
| Hosting files | IIS `web.config` for the API and the website | [deploy/iis/](deploy/iis/) |

## Project layout

```
api/AquaPure.Api/          the API (Controllers, Auth, Payments, Infrastructure)
api/AquaPure.Api.Tests/    unit tests + integration tests against the real SQL scripts
database/migrations/       SQL scripts 0001–0009, run in order (or the combined file below)
database/seed.sql          sample categories, products, zones, slots, reviews
database/supabase-setup.sql  everything above in one file for the Supabase SQL Editor
database/tests/            database tests (in-memory Postgres)
web/src/app/pages/         customer pages        web/src/app/admin/   staff and admin dashboard
web/src/app/core/          API, auth, cart, payment services; business details (business.ts)
web/e2e/                   browser tests (Playwright)
deploy/iis/                web.config files for production
```

## Commands

| What | Command (from the folder shown) |
|---|---|
| Install website packages | `cd web` then `npm install` |
| Run the website (http://localhost:4200) | `cd web` then `npm start` |
| Run the API (http://localhost:5080) | `dotnet run --project api/AquaPure.Api` (or F5 in Visual Studio) |
| Build everything for production | `cd web` then `npm run build`; and `dotnet build AquaPure.sln -c Release` |
| Lint the website | `cd web` then `npm run lint` |
| Website unit tests | `cd web` then `npm run test:ci` |
| Browser tests (start the API first) | `cd web` then `npm run e2e` |
| API tests | `dotnet test AquaPure.sln` (needs `npm install` in `database` once) |
| Database tests | `cd database` then `npm install` and `npm test` |
| Rebuild the one-file SQL setup | `cd database` then `npm run build` |

## Tests

- **Database (47):** permissions for visitors, customers, staff, admins and the API role; pricing, stock, slots, deposits, status changes; Razorpay edge cases (repeated callbacks, failed attempts, wrong amounts, late payments, expiry).
- **API (39):** token checks, error handling, Razorpay signatures, and integration tests that run the real API against the real SQL scripts in an in-memory Postgres (Razorpay simulated).
- **Website unit tests (10)** and **browser tests** on phone, tablet and desktop sizes, including a full-stack run: browser → real API → real SQL scripts (only sign-in is simulated) for checkout, order tracking, cancelling, and the staff and admin dashboards. Razorpay's payment window is simulated in the browser tests.

**Not yet tested end to end:** a real Razorpay test payment (needs your Razorpay test keys) and real email delivery from Supabase. See SETUP.md section 10.

## Before going live

- Fill in your phone, WhatsApp, email and address in [web/src/app/core/business.ts](web/src/app/core/business.ts) (empty values are hidden, never shown as fake numbers).
- Replace the sample prices, zones, slots and reviews from the admin dashboard.
- Make sure every claim on the site (purity, certifications) is one you can back up.

## Security notes

- Never commit `.env`, `secrets.config`, `web/public/config.json` or any key. `.gitignore` already excludes them.
- Rate limits on order placing, payments and enquiries; security headers on the API; validation in the website, the API and the database.
- Some Indian ISPs block `*.supabase.co`. See SETUP.md 15.4 for a proxy on your own domain.
