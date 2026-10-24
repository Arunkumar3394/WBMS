# WBMS: Water Business Management System

Manages water-can orders from booking to delivery: one Angular website, made for phones, with pages for customers, drivers and staff, and a .NET Framework 4.7 Web API behind it.

## Order flow

Customer books water → order created → payment (cash / credit / Razorpay) → admin confirms → driver assigned →
driver starts delivery (OTP sent to customer) → live GPS tracking → driver enters OTP, full cans delivered and empty cans collected →
delivery completed → invoice and customer balance updated.

## Projects

| Project | What it is |
|---|---|
| `src/Wbms.Api47` | **.NET Framework 4.7** ASP.NET Web API 2 (C#, OWIN self-host, EF6, SQL Server). Serves the API and the built Angular site |
| `src/wbms-web` | **Angular** website for phones and computers: customer pages (sign up, book, pay online, track the driver, invoices), driver pages under `/driver` (deliveries, start, share location, customer's code, cans and cash) and admin pages under `/admin` |
| `tests/Wbms.Api47.Tests` | Tests for the 4.7 API (xUnit, in-memory database, no SQL Server needed) |
| `src/Wbms.Api`, `src/Wbms.Admin`, `src/Wbms.Core`, `src/Wbms.Data`, `tests/Wbms.Tests` | The earlier .NET 8 API and Blazor admin. Replaced by the two projects above; they will be removed once the new ones are running for you |

## Run it (Visual Studio)

You need Visual Studio 2022 with the **ASP.NET and web development** workload (includes .NET Framework 4.7 targeting and SQL Server LocalDB), and [Node.js](https://nodejs.org) 20.19 or newer.

1. Build the website once: open a terminal in `src/wbms-web` and run `npm install`, then `npm run build`. This puts the site in `src/Wbms.Api47/wwwroot`.
2. Open `Wbms.sln`, set **Wbms.Api47** as the startup project and press F5. A console window opens with `WBMS API running at http://localhost:5080/`.
3. Open http://localhost:5080 for the customer site and http://localhost:5080/admin for the admin pages.

The database `Wbms47` is created in LocalDB on first start, with demo data (`Seed:DemoData` in `src/Wbms.Api47/App.config`). To try it without SQL Server, set `Db:InMemory` to `true`; data is then lost when the API stops.

While changing the website, run `npm start` in `src/wbms-web` and open http://localhost:4200; it reloads on every save and sends API calls to the running API.

Tests: open Test Explorer and run `Wbms.Api47.Tests`.

### Signing in

- **Admin pages (`/admin`):** phone `9000000000`, password `Admin@12345` (demo data). Change it on the *Account* page, and add staff on *Staff*.
- **Customers:** sign up on the website, or use the demo customer `9000000002`. The 4-digit code is printed in the API console window until SMS is set up.
- **Drivers:** sign in on the same site with their phone number and code; they land on `/driver`. Demo driver `9000000001`.
- API: `POST /api/auth/request-otp` with a phone number, then `POST /api/auth/verify` with the code to get a token; staff use `POST /api/auth/password`.

### Using it on phones

Customers, drivers and staff all use the website in their phone's browser; there is no app to install.

- To open it from a phone on the same Wi-Fi while testing: in `src/Wbms.Api47/App.config` set `Web:Url` to `http://+:5080/`, run once in a Command Prompt as administrator `netsh http add urlacl url=http://+:5080/ user=Everyone`, then open `http://<your PC's IP>:5080` on the phone.
- **Drivers' location needs https.** Phone browsers only share location with `https://` sites, so live tracking works once the site is hosted with an SSL certificate (or on `localhost`). Everything else works on plain http.
- Live tracking: the driver's phone sends its position every 15 seconds while the delivery page is open, and the customer's order page refreshes every 10 seconds.

## Going live: settings to fill in

To put the site on a server (Windows VPS, Azure or your own PC), run `deploy\make-package.cmd` and follow [deploy/DEPLOY.md](deploy/DEPLOY.md). The package runs under IIS and takes these settings from its `Web.config`.

All settings are in `src/Wbms.Api47/App.config` (`<appSettings>`). Put secrets in environment variables instead, writing `:` as `__` (for example `Msg91__AuthKey`).

| Setting | What |
|---|---|
| `Jwt:Key` | 32+ random characters. The one in App.config is for development only |
| `Sms:Provider` = `Msg91`, `Msg91:AuthKey`, `Msg91:LoginTemplateId`, `Msg91:DeliveryTemplateId` | Real SMS codes. Create two DLT-approved Flow templates in MSG91 using `##otp##` (and `##order##` for delivery). Leave `Sms:Provider` as `Console` to print codes instead |
| `Razorpay:KeyId`, `Razorpay:KeySecret`, `Razorpay:WebhookSecret` | Online payment. In the Razorpay dashboard add a webhook to `https://<your-site>/api/razorpay/webhook` for `payment_link.paid` and `payment.captured` |
| `Razorpay:CallbackUrl` | Where customers return after paying, e.g. `https://<your-site>/orders/{orderId}` |
| `Business:Name`, `Address`, `Phone`, `Gstin` | Printed on invoice PDFs |
| `Seed:DemoData` | Set to `false` before real use (the server package already does) |
| `Setup:AdminPhone`, `Setup:AdminPassword` | Creates the first admin on a database that has none. Clear them after signing in |
| `Web:Url` | Address the API listens on, e.g. `http://+:80/` on a server |

## Not done yet

- Driver location is shared only while the delivery page is open in the driver's browser (browsers don't allow background tracking).
- Database changes after the first run: EF6 creates the database once; later model changes will need EF6 migrations (`Enable-Migrations` in the Package Manager Console).
- GST calculation on invoices (the tax field exists but is always 0).
