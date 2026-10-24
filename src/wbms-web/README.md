# WBMS website (Angular)

Customer site (sign up, book water, pay, track the driver, invoices) and the admin pages (`/admin`) in one Angular app.
It talks to the .NET Framework 4.7 API in `../Wbms.Api47`.

```
npm install
npm start          # http://localhost:4200, API calls go to http://localhost:5080 (proxy.conf.json)
npm run build      # builds into ../Wbms.Api47/wwwroot, which the API serves at http://localhost:5080
```

Needs Node.js 20.19 or newer.
