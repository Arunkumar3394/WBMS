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
| `tests/Wbms.Tests` | Workflow tests (xUnit, in-memory database) |

## Run it (Visual Studio)

1. Open `Wbms.sln` in Visual Studio 2022 (with the ASP.NET workload, .NET 8).
2. The connection string in `appsettings.json` uses SQL Server LocalDB, which comes with Visual Studio. The database is created and migrated on first start, and demo data is added in Development.
3. Right-click the solution → *Configure Startup Projects* → start both `Wbms.Admin` and `Wbms.Api`.
4. The API's Swagger page lists every endpoint.

Command line: `dotnet test`, `dotnet run --project src/Wbms.Admin`, `dotnet run --project src/Wbms.Api`.

## Not done yet

- Login and roles (ASP.NET Identity + JWT). **Do not expose the API or admin to the internet until this is added.**
- SMS for the OTP (currently printed to the API console by `ConsoleOtpSender`).
- Razorpay order creation from the app (the webhook that marks orders paid is in place; set `Razorpay:WebhookSecret`).
- Invoice PDFs, reports, and the .NET MAUI mobile app.
