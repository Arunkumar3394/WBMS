# WBMS: Water Business Management System

Manages water-can orders from booking to delivery, with an admin web app and (coming next) a mobile app for customers and drivers.

## Order flow

Customer books water → order created → payment (cash / credit / Razorpay) → admin confirms → driver assigned →
driver starts delivery (OTP sent to customer) → live GPS tracking → driver enters OTP, full cans delivered and empty cans collected →
delivery completed → invoice and customer balance updated.

## Projects

| Project | What it is |
|---|---|
| `src/Wbms.Core` | Entities, order statuses, OTP helper |
| `src/Wbms.Data` | EF Core `WbmsDbContext`, migrations, `OrderService` (the order workflow), demo seed data |
| `src/Wbms.Api` | ASP.NET Core Web API for the mobile app, SignalR hub `/hubs/tracking`, Razorpay webhook |
| `src/Wbms.Admin` | Blazor Server admin: dashboard, orders (confirm/assign/cancel/phone orders), customers & dues, drivers, products & stock |
| `src/Wbms.Client` | Shared logic for the mobile app: API client and view models (login, driver deliveries, customer booking, live tracking) |
| `src/Wbms.Mobile` | .NET MAUI Android app for customers and drivers (same app, screens depend on who signs in) |
| `tests/Wbms.Tests` | Workflow tests (xUnit, in-memory database) |

## Run it (Visual Studio)

1. Open `Wbms.sln` in Visual Studio 2022 (with the ASP.NET workload, .NET 8).
2. The connection string in `appsettings.json` uses SQL Server LocalDB, which comes with Visual Studio. The database is created and migrated on first start, and demo data is added in Development.
3. Right-click the solution → *Configure Startup Projects* → start both `Wbms.Admin` and `Wbms.Api`.
4. The API's Swagger page lists every endpoint.

### Mobile app (Android)

1. In the Visual Studio Installer, add the **.NET Multi-platform App UI development** workload.
2. Start `Wbms.Api` (the `http` profile, port 5196), then set `Wbms.Mobile` as the startup project and run it on an Android emulator.
3. The app talks to `http://10.0.2.2:5196/` (your PC from the emulator). For a real phone, change `ApiConfig.BaseUrl` to your PC's Wi-Fi address and start the API with `--urls http://0.0.0.0:5196`.
4. Sign in as the demo driver `9000000001` or customer `9000000002`; the code appears in the API console window.

If Visual Studio says it can't load `Wbms.Mobile`, the MAUI workload is missing; everything else still works.

### Signing in

- **Admin web:** phone `9000000000`, password `Admin@12345` (demo data, Development only). Change it on the *Account* page, and add staff on *Staff logins*.
- **API / mobile app:** `POST /api/auth/request-otp` with a phone number, then `POST /api/auth/verify` with the code to get a token. In Development the code is printed in the API console. Demo phones: driver `9000000001`, customer `9000000002`. New customers sign up with `POST /api/auth/register`.
- In Swagger, click *Authorize* and paste the token.
- Production needs a real `Jwt:Key` (32+ characters) set as a secret or the `Jwt__Key` environment variable; the API refuses to start without one.

Command line: `dotnet test tests/Wbms.Tests`, `dotnet run --project src/Wbms.Admin`, `dotnet run --project src/Wbms.Api`.

## Not done yet

- SMS for login and delivery OTPs (currently printed to the console by `ConsoleOtpSender`). **Needed before going live.**
- Razorpay order creation from the app (the webhook that marks orders paid is in place; set `Razorpay:WebhookSecret`).
- Invoice PDFs and reports.
- Mobile app: location is shared only while the delivery screen is open (no background tracking yet), the map opens in Google Maps rather than inside the app, and online payment in the app is not wired up (customers choose cash or credit).
