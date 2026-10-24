# AquaPure Water: setup guide

This guide takes you from a fresh computer to a live website. Do the sections in order the first time. Commands are for **Windows** (PowerShell or the VS Code terminal), run from the project folder (`D:\WBMS`) unless a step says otherwise.

**Contents**
1. [Prerequisites and software](#1-prerequisites-and-software)
2. [Run the project locally](#2-run-the-project-locally)
3. [Install dependencies](#3-install-dependencies)
4. [Configure settings and secrets](#4-configure-settings-and-secrets)
5. [Create a Supabase project](#5-create-a-supabase-project)
6. [Run the database SQL scripts](#6-run-the-database-sql-scripts)
7. [Configure Supabase sign-in and security (RLS)](#7-configure-supabase-sign-in-and-security-rls)
8. [Deploy the backend](#8-deploy-the-backend)
9. [Configure Razorpay test keys](#9-configure-razorpay-test-keys)
10. [Test a complete order and payment](#10-test-a-complete-order-and-payment)
11. [Set up the admin account securely](#11-set-up-the-admin-account-securely)
12. [Add or update products, prices and images](#12-add-or-update-products-prices-and-images)
13. [Delivery areas, charges and time slots](#13-delivery-areas-charges-and-time-slots)
14. [Connect GitHub and push the code](#14-connect-github-and-push-the-code)
15. [Deploy the website](#15-deploy-the-website)
16. [Production credentials](#16-production-credentials)
17. [Common errors and fixes](#17-common-errors-and-fixes)

---

## 1. Prerequisites and software

Install these once:

| Software | Why | Where |
|---|---|---|
| **Node.js 22 or 24 (LTS)** | Builds and runs the website, runs the database tests | nodejs.org. Check with `node -v` |
| **.NET SDK 8** | Builds the API (`dotnet build`) | dotnet.microsoft.com/download. Check with `dotnet --version` |
| **.NET Framework 4.8 Developer Pack** | The API targets .NET Framework 4.8 | dotnet.microsoft.com/download/dotnet-framework/net48 |
| **Visual Studio 2022** (optional) | Easiest way to run and debug the API (F5) | "ASP.NET and web development" workload |
| **Git** | Version control | git-scm.com |
| **Google Chrome** | Browser tests use your installed Chrome | google.com/chrome |

Accounts you need: **Supabase** (free plan is fine to start), **Razorpay** (test mode works before KYC), **GitHub** (you have one).

> **Internet note for India.** Some ISPs block `*.supabase.co` (it resolves to `127.0.0.1`). If sign-in fails with "Cannot reach the sign-in service", see [section 17](#17-common-errors-and-fixes): turn on **Secure DNS** in Chrome and in Windows.

## 2. Run the project locally

After sections 3–7 are done, every day you only need two terminals:

```powershell
# Terminal 1: the API on http://localhost:5080
dotnet run --project api/AquaPure.Api
```
It prints `AquaPure API running at http://localhost:5080/`. (Or open `AquaPure.sln` in Visual Studio and press **F5**.)

```powershell
# Terminal 2: the website on http://localhost:4200
cd web
npm start
```

Open http://localhost:4200. Check http://localhost:5080/api/health shows `{"status":"ok"}`. If it doesn't, the API cannot reach the database (see section 17).

## 3. Install dependencies

```powershell
cd web
npm install          # website packages
cd ..\database
npm install          # database test tools (also needed by the API's integration tests)
cd ..
dotnet build AquaPure.sln   # downloads the API's NuGet packages and builds it
```

Optional, for the browser tests: nothing extra. They use your installed Chrome.

## 4. Configure settings and secrets

All settings are listed in [.env.example](.env.example). There are two local files to create. **Both are git-ignored, never commit them.**

**API secrets**: copy `api/AquaPure.Api/secrets.config.example` to `api/AquaPure.Api/secrets.config` and fill in:

| Key | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase → **Connect** (top bar) or **Project Settings → Data API** → Project URL |
| `DB_CONNECTION` | Supabase → **Connect → Session pooler**. User is `wbms_api.YOUR-PROJECT-REF`, password from section 6 step 4 |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Section 9 (leave the placeholder values out until then: delete the lines or leave them empty) |
| `RAZORPAY_WEBHOOK_SECRET` | Section 9 (needed for production) |
| `SUPABASE_JWT_SECRET` | Leave empty. Only for old projects without signing keys |

Other API settings (address, allowed website origins) are in `api/AquaPure.Api/App.config` and are fine for local use. On a server, environment variables override both files.

**Website settings**: copy `web/public/config.example.json` to `web/public/config.json`:

```json
{
  "apiBaseUrl": "http://localhost:5080",
  "supabaseUrl": "https://YOUR-PROJECT-REF.supabase.co",
  "supabasePublishableKey": "sb_publishable_..."
}
```
The publishable key is in **Project Settings → API Keys**. It is public by design, and the database refuses it everything except sign-in.

**Business details**: open [web/src/app/core/business.ts](web/src/app/core/business.ts) and fill in phone, WhatsApp (digits with country code, e.g. `9198xxxxxxxx`), email, address and service areas. Anything left empty is hidden on the site.

> Never put the Supabase **service_role / secret key** anywhere. This project does not need it.

## 5. Create a Supabase project

1. Sign in at supabase.com → **New project**.
2. Name: `aquapure`. **Database password**: generate a strong one and keep it in a password manager (it is the owner password; the API does not use it).
3. **Region**: pick the one closest to your customers, e.g. **Mumbai (ap-south-1)**. (Your current project is in Tokyo; that works, but each request takes longer.)
4. Wait until the project is ready, then note the **Project URL** and **publishable key** (section 4).

## 6. Run the database SQL scripts

1. In VS Code open `database/supabase-setup.sql`, press **Ctrl+A**, **Ctrl+C**.
2. Supabase → **SQL Editor → New query**, paste, **Run**.
3. The result says **AquaPure database installed**. If you see an error, nothing was changed. Read the message (it explains what is missing) and try again.
4. Give the API its own database password. Run this in the SQL Editor with a long random password:
   ```sql
   alter role wbms_api with password 'paste-a-long-random-password-here';
   ```
   Put the same password in `DB_CONNECTION` (section 4). Use it nowhere else.
5. Optional but recommended: enable **pg_cron** (**Database → Extensions**, or **Integrations → Cron**) and run `database/migrations/0009_cron.sql`. It cancels online orders that stay unpaid (default 30 minutes) and frees their stock. Without it, the setup still works; it just showed a notice.

What the scripts create (tables, RLS, functions, storage bucket, sample data) is listed in [database/README.md](database/README.md). The individual files `migrations/0001`–`0010` and `seed.sql` run in that order; `supabase-setup.sql` is all of them combined.

**Installed before a new migration was added?** Run only the new file. For example, if you installed before `0010_cans_per_unit.sql` existed, copy that whole file into a new SQL Editor query and **Run** it once. It is safe to run again.

## 7. Configure Supabase sign-in and security (RLS)

**Sign-in (Authentication)**
1. **Authentication → Sign In / Providers → Email**: keep **Email** enabled and **Confirm email** on.
2. Same page: set **Minimum password length** to **8** and require **letters and digits** (the site asks for the same).
3. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:4200` now; your real address (`https://www.your-domain.in`) when you go live.
   - Redirect URLs: add `http://localhost:4200/**` and later `https://www.your-domain.in/**`.
   Without these, the links in confirmation and password-reset emails do not come back to the site.
4. **Email sending**: Supabase's built-in email sends only a few emails per hour, which is fine for testing. Before launch, add your own SMTP service (e.g. Resend, Brevo, Amazon SES) under **Authentication → Emails → SMTP Settings**, and edit the email templates to say "AquaPure Water".
5. **Phone sign-in (OTP)** is not switched on yet. It needs an SMS provider (e.g. Twilio, MSG91) and, in India, DLT registration of your sender ID and templates. Tell your developer when you have them.

**Security (RLS)**: already done by the scripts. Check two things:
1. **Project Settings → Data API → Exposed schemas**: leave it as `public` (plus `graphql_public` if listed). **Do not add `app`.** All AquaPure data is in the `app` schema, which is reachable only through the API.
2. **Database → Tables**, schema `app`: every table shows **RLS enabled**.

## 8. Deploy the backend

This project does **not** use Supabase Edge Functions. Its backend has two parts:

- **Database functions** (pricing, orders, payments, permissions) are installed by the SQL scripts in section 6. To change them later, edit the files in `database/migrations/`, run the database tests (`cd database`, `npm test`), and run only the changed statements in the SQL Editor.
- **The API** (`api/AquaPure.Api`) handles sign-in tokens, Razorpay and every data request. Locally it runs with `dotnet run` (section 2); in production it runs on Windows/IIS (section 15).

## 9. Configure Razorpay test keys

1. Sign in at dashboard.razorpay.com and switch the toggle to **Test Mode**.
2. **Account & Settings → API Keys → Generate Test Key**. Copy the **Key ID** (`rzp_test_...`) and **Key Secret** (shown once).
3. Put them in `secrets.config` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Restart the API. It now prints `Razorpay: test mode`.
4. In the admin dashboard (**Settings**) make sure **Online payment** is ticked.
5. **Webhook** (needed in production; optional locally): **Account & Settings → Webhooks → Add New Webhook**
   - URL: `https://api.your-domain.in/api/payments/razorpay/webhook`
   - Secret: type a long random value and put the same in `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured`, `payment.failed`, `order.paid`
   Razorpay cannot reach `localhost`. Locally, payments are confirmed by the site's own check right after paying; the webhook is the backup for customers who close the page. To test webhooks locally you can use a tunnel (e.g. Cloudflare Tunnel or ngrok) to expose port 5080.

**Going live later**: complete Razorpay KYC, switch to **Live Mode**, generate live keys (`rzp_live_...`), create the webhook again in live mode, and put the live keys and webhook secret on the server (section 16). The API refuses to start with live keys but no webhook secret.

## 10. Test a complete order and payment

1. Start the API and the website (section 2). Open http://localhost:4200.
2. **Sign up** with your email, open the confirmation email, then sign in.
3. **My account**: add an address with a pincode from a delivery zone (the sample zones use `600001`–`600005` and `600010`–`600018`; change them in section 13).
4. Add a 20 L can to the cart → **Checkout**. Check the delivery charge and total, pick **Tomorrow** and a slot.
5. **Cash on delivery**: choose it and **Place order**. You see "Thank you! Your order has been placed." and the order page.
6. **Online payment** (after section 9): place another order with **Pay online now**. In Razorpay's test window use the test card or UPI details from Razorpay's documentation ("Test card details" / "Test UPI"). After paying, the order page says "Thank you! Your payment was received." Also try failing or closing the payment window: the order stays unpaid and shows **Pay now**.
7. **As admin** (section 11): **Admin dashboard → Orders**: confirm the order, set **Out for delivery**, then **Mark delivered** (and for cash orders, **Cash / UPI received**). The customer's order page shows each step.
8. Check the Razorpay Dashboard (Test Mode) → **Transactions**: the payment is there and matches the order number.

Automated tests (run them after changes):
```powershell
cd database; npm test; cd ..          # 47 database tests
dotnet test AquaPure.sln               # 39 API tests (stop the running API first)
cd web; npm run lint; npm run test:ci  # lint + unit tests
npm run e2e                            # browser tests (start the API first)
```

## 11. Set up the admin account securely

1. Sign up on the website with the email you want as admin and confirm it.
2. In the Supabase **SQL Editor** run (with your email):
   ```sql
   update app.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Sign out and in again. **My account** now shows **Admin dashboard** (or go to `/admin`).
4. Add staff from the dashboard: they sign up first, then **Customers → (their name) → Access → Staff**. Staff can handle orders, customers, enquiries and reports, but not products, prices, delivery or settings.
5. Good practice: use a strong unique password, keep only one or two admins, block accounts of people who leave (**Access → untick "Account active"**). The database refuses to remove the last admin.

## 12. Add or update products, prices and images

**Admin dashboard → Products**
- **Edit** a product to change its name, price, unit, minimum/maximum per order, descriptions, and whether it is shown.
- **Sample price**: the seeded prices are marked as samples and show a "Sample price" badge. Untick it once the price is real.
- **Returnable can / deposit**: tick "Returnable can", set how many cans one unit holds (1 for a single can, 5 for a pack of five) and the deposit per can; switch deposits on in **Settings**. A customer pays a deposit only for cans beyond those they already hold with a deposit (including cans on their open orders). Record returned cans and refunds under **Customers → (name) → Can deposits**.
- **Stock**: **Stock** button → enter `+50` for new stock or `-3` for damaged cans. Every change is kept in the history. Orders stop at zero.
- **Images**: **Edit → Upload image** (JPG, PNG or WebP, up to 5 MB; square photos look best). Images go to the Supabase Storage bucket `product-images`, which only admins can upload to. Use only photos you own; don't show other brands' logos.
- **Categories**: **Admin → Categories**.
- **Reviews**: **Admin → Reviews**. The three seeded reviews are samples and say so. Replace them with real reviews you have permission to show.

The pictures on the public pages (hero, services) are in `web/public/images/`. `npm run images` re-creates them from the `images/` folder.

## 13. Delivery areas, charges and time slots

**Admin dashboard → Delivery**
- **Zones**: each zone has a list of pincodes, a delivery charge, an optional "free delivery from" amount, and a minimum order. Customers can order only to pincodes in an active zone. The two seeded zones are samples, so replace their pincodes with yours.
- **Slots**: name, start and end time, how many orders per slot, which days, and how long before the start booking closes (e.g. 120 minutes).

**Admin dashboard → Settings**: how many days ahead customers can book, closed dates (holidays), cash on delivery and online payment on/off, can deposits on/off, and how long unpaid online orders are kept.

## 14. Connect GitHub and push the code

The work is on the branch **`feature/aquapure-website`**, made from your `main`. Nothing has been pushed yet.

1. Check where you are:
   ```powershell
   git status          # should say "nothing to commit, working tree clean"
   git branch --show-current
   git remote -v       # origin https://github.com/Arunkumar3394/WBMS.git
   ```
2. Push the branch (first time):
   ```powershell
   git push -u origin feature/aquapure-website
   ```
   If Git asks you to sign in, use the browser window from **Git Credential Manager** (installed with Git for Windows), or run `gh auth login` if you use the GitHub CLI. A "permission denied" error means the signed-in GitHub account cannot write to the repository.
3. On GitHub, open a **Pull request** from `feature/aquapure-website` into `main`, review it, and merge.
4. Never use `git push --force` on `main`. Before every commit, check `git status` shows no `secrets.config`, `config.json` or `.env` files (they are ignored, but check anyway).

## 15. Deploy the website

Because the API runs on **.NET Framework 4.8**, it needs a **Windows server with IIS**. Recommended: a small Windows VPS (any provider, 2 GB RAM is enough to start) hosting both the website and the API. The website itself is plain static files and could also go on any static host, as long as every unknown path serves `index.html`.

The files in [deploy/iis/](deploy/iis/) are ready-made `web.config`s. They are written to the standard IIS modules' documentation, but have **not been tested on a real IIS server yet**, so test on your server before announcing the site.

### 15.1 Prepare the server (once)
1. Windows Server with **IIS** (Server Manager → Add roles → Web Server). Install the **.NET Framework 4.8** runtime if missing.
2. Install the IIS modules **URL Rewrite** and **HttpPlatformHandler** (free downloads from Microsoft's IIS site). For the optional Supabase proxy also install **Application Request Routing (ARR)** and tick **Enable proxy** in its server settings.
3. Point your domain's DNS: `www.your-domain.in` and `api.your-domain.in` → the server's IP.
4. HTTPS certificates: e.g. **win-acme** (free Let's Encrypt certificates, renews automatically) for both names.

### 15.2 The API (`https://api.your-domain.in`)
1. Build: `dotnet build AquaPure.sln -c Release`. Copy everything in `api\AquaPure.Api\bin\Release\net48\` to e.g. `C:\sites\aquapure-api\`.
2. Copy `deploy\iis\api.web.config` there as `web.config`. Set `ALLOWED_ORIGINS` and `SUPABASE_URL` in it.
3. Secrets: either add `DB_CONNECTION` and the `RAZORPAY_*` values as environment variables in that `web.config`, or copy a filled-in `secrets.config` next to the exe (section 16).
4. Create a `logs` folder there and give the IIS app pool identity write access.
5. IIS → add a site `aquapure-api` with that folder, binding `https` / `api.your-domain.in`.
6. Open `https://api.your-domain.in/api/health` → `{"status":"ok"}`.

### 15.3 The website (`https://www.your-domain.in`)
1. Build: `cd web`, `npm run build`. Copy everything in `web\dist\aquapure-web\browser\` to e.g. `C:\sites\aquapure-web\`.
2. Copy `deploy\iis\site.web.config` there as `web.config`.
3. Create `config.json` there (copy of `config.example.json`) with `"apiBaseUrl": "https://api.your-domain.in"` and your Supabase URL and publishable key.
4. IIS → add a site `aquapure-web` with that folder, binding `https` / `www.your-domain.in` (and redirect the bare domain to `www`).
5. Supabase → **Authentication → URL Configuration**: Site URL `https://www.your-domain.in`, add `https://www.your-domain.in/**` to Redirect URLs.
6. Razorpay webhook URL → `https://api.your-domain.in/api/payments/razorpay/webhook` (section 9).
7. Test sign-up, an order and a payment on the live site (section 10).

### 15.4 If customers' ISPs block Supabase
Some Indian ISPs answer `*.supabase.co` with `127.0.0.1`. Customers on those networks then cannot sign in or see product images, even though your own Secure DNS fix works. Two ways round it:
- **A proxy on your own domain** (free): in `site.web.config`, un-comment the **Supabase proxy** rule and put your project ref in it (needs ARR, section 15.1). Then set `"supabaseUrl": "https://www.your-domain.in/supabase"` in `config.json`, and `SUPABASE_PUBLIC_URL=https://www.your-domain.in/supabase` on the API. Leave the API's own `SUPABASE_URL` as the real `supabase.co` address.
- **Supabase custom domain** (paid add-on): e.g. `db.your-domain.in`. Then use that address in both places.

Test it from a phone on mobile data and from a home broadband connection.

## 16. Production credentials

- Keep secrets **only on the server**: as environment variables in the API's `web.config`, or in `secrets.config` next to the exe. Restrict that folder (NTFS permissions) to Administrators and the IIS app pool identity.
- Use **different** values in production from your laptop: a new `wbms_api` password (`alter role wbms_api with password '...'`), live Razorpay keys, a new webhook secret.
- `ALLOWED_ORIGINS` must list only your real site address(es), with `https://`.
- If a secret is ever shared, pasted somewhere or committed: **change it at once** (new `wbms_api` password; regenerate Razorpay keys), then update the server.
- Turn on two-factor sign-in for your Supabase, Razorpay, GitHub and hosting accounts.
- **Backups**: Supabase's free plan has limited backups. Check what your plan includes (**Database → Backups**), or export regularly.
- The Supabase **service_role / secret key** is never needed. Don't create copies of it.

## 17. Common errors and fixes

| What you see | Cause | Fix |
|---|---|---|
| "Cannot reach the sign-in service", or Chrome `ERR_CONNECTION_REFUSED` to `…supabase.co` | Your ISP blocks Supabase (answers `127.0.0.1`) | Chrome → Settings → Privacy and security → Security → **Use secure DNS** → On → **Cloudflare (1.1.1.1)**. Windows: use encrypted DNS (Settings → Network → DNS → 1.1.1.1 with DNS over HTTPS). For customers see 15.4 |
| API prints `Configuration error: Set SUPABASE_URL…` or `…DB_CONNECTION…` | `secrets.config` missing or empty | Section 4 |
| `/api/health` fails, log says `Tenant or user not found` | Wrong pooler user name or region | Copy the **Session pooler** host from Supabase → Connect; user must be `wbms_api.YOUR-PROJECT-REF` |
| `password authentication failed for user "wbms_api"` | Password in `DB_CONNECTION` differs from the database | Run `alter role wbms_api with password '...'` again and update `DB_CONNECTION` |
| Site shows "Cannot reach AquaPure right now" | API not running, wrong `apiBaseUrl`, or blocked by CORS | Start the API; check `config.json`; add the site address to `ALLOWED_ORIGINS` (exact, no trailing `/`) and restart |
| API won't start: `Access is denied` / port in use | Another program (or a second API) on port 5080 | Close it, or change `API_URL` and `apiBaseUrl` |
| Signed in, but "Your session has expired" again and again | Computer clock wrong, or `SUPABASE_URL` on the API is a different project | Sync Windows time; check both URLs match |
| Confirmation email link opens the wrong site or errors | Site URL / Redirect URLs not set | Section 7, step 3 |
| No confirmation emails | Built-in email limit (a few per hour) or spam folder | Wait, check spam; set up SMTP (section 7) |
| "Sorry, we do not deliver to pincode …" | Pincode is in no active zone | Admin → Delivery → zones |
| No delivery slots / "Booking closed" | Slots inactive, wrong days, or past the cut-off | Admin → Delivery → slots; Settings → closed dates |
| "Online payment is not available right now" | Razorpay keys not set, or online payment switched off | Section 9; Admin → Settings |
| Payment taken but order still "Payment pending" | Webhook not set up and the customer closed the page | Set up the webhook (section 9). It is matched automatically once the webhook arrives |
| Order shows "Needs refund" | Paid, then cancelled (or paid twice) | Refund in the Razorpay Dashboard, then **Mark refunded** on the order |
| Image upload says "Only admins can upload images" | Signed in as staff, or role not admin | Section 11 |
| SQL Editor: "AquaPure is already installed" | Running the setup twice | Nothing to do. To start over on a **test** project only: `drop schema app cascade;` then run it again |
| `npm test` in `database` says "Cannot find module …\tests" | Old test command on Node 24 | Pull the latest code (`node --test "tests/*.test.mjs"`) |
| `dotnet test` cannot copy `AquaPure.Api.exe` | The API is still running | Stop it (Ctrl+C), then run the tests |
| Browser tests can't start Chrome | Chrome not installed | Install Google Chrome |
