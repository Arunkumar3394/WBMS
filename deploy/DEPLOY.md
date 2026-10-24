# Putting WBMS on the internet

The website (customer pages, driver pages and admin) and the API run as one IIS site on Windows.
Pick one of the three places below; the package and the settings are the same for all of them.

| | Monthly cost (approx.) | Good for |
|---|---|---|
| **A. Windows VPS** (recommended) | ₹1,500–3,000 | Full control, SQL Server Express on the same machine for free |
| **B. Azure App Service** | ₹1,100+ (Basic B1) plus Azure SQL ₹400+ | No server to look after |
| **C. Your own PC or office server** | Electricity + a static IP | Trying it out; the PC must stay on |

## 1. Build the package (on your PC)

1. Open the repository folder and double-click `deploy\make-package.cmd` (needs Node.js and Visual Studio / the .NET SDK).
2. It creates:
   - `publish\site\` — the folder to copy to the server
   - `publish\wbms-site.zip` — the same folder zipped, for Azure

Do this again whenever you update the code.

## 2. Settings (`Web.config` inside the site folder)

Open `Web.config` on the server in Notepad and fill in these values in `<appSettings>`:

| Setting | What to put |
|---|---|
| `Jwt:Key` | Your own random text, 32+ characters. Generate one in PowerShell: `$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`. The site refuses to start without it |
| `Setup:AdminPhone`, `Setup:AdminPassword` | Your phone number and a password (8+ characters). The first admin account is created with these on the first start. Clear both values after you have signed in |
| `Sms:Provider` = `Msg91`, `Msg91:AuthKey`, `Msg91:LoginTemplateId`, `Msg91:DeliveryTemplateId` | Needed for customers and drivers to receive sign-in and delivery codes. On a server `Console` sends codes nowhere |
| `Razorpay:KeyId`, `Razorpay:KeySecret`, `Razorpay:WebhookSecret` | Online payments. In the Razorpay dashboard add a webhook to `https://<your-domain>/api/razorpay/webhook` for `payment_link.paid` and `payment.captured` |
| `Razorpay:CallbackUrl` | `https://<your-domain>/orders/{orderId}` |
| `Business:Name`, `Address`, `Phone`, `Gstin` | Printed on invoices |

The database connection is under `<connectionStrings>` (`Wbms`). The default, `Server=.\SQLEXPRESS;Database=Wbms;Trusted_Connection=True`, fits option A. The database and its tables are created on the first start.

Demo accounts are switched off in the package (`Seed:DemoData` = `false`), and the development signing key is blanked.

## Option A: Windows VPS (recommended)

Any provider works (for example Hostinger, OVH, Contabo, AWS Lightsail Windows, Azure VM). Choose **Windows Server 2019 or 2022**, 2 CPU / 4 GB RAM.

1. **Connect** with Remote Desktop using the IP and password the provider gives you.
2. **Install IIS with ASP.NET.** Open PowerShell as administrator:
   ```powershell
   Install-WindowsFeature Web-Server, Web-Asp-Net45, Web-Mgmt-Console
   ```
3. **Install SQL Server Express** (free): download "SQL Server 2022 Express" from microsoft.com, choose *Basic*. It installs as `.\SQLEXPRESS`.
4. **Copy the site:** copy the contents of `publish\site` to `C:\inetpub\wbms` (Remote Desktop copy-paste works).
5. **Create the IIS site.** Open *IIS Manager*:
   - *Application Pools* → *Add*: name `wbms`, .NET CLR **v4.0**, pipeline **Integrated**.
   - *Sites* → *Add Website*: name `wbms`, application pool `wbms`, physical path `C:\inetpub\wbms`, binding http port 80, host name `yourdomain.com` (leave empty to test with the IP first).
   - Stop or delete *Default Web Site* if it uses port 80.
6. **Let the site use SQL Server.** PowerShell as administrator:
   ```powershell
   sqlcmd -S .\SQLEXPRESS -E -Q "CREATE LOGIN [IIS APPPOOL\wbms] FROM WINDOWS; ALTER SERVER ROLE dbcreator ADD MEMBER [IIS APPPOOL\wbms];"
   ```
7. **Fill in `C:\inetpub\wbms\Web.config`** (section 2), at least `Jwt:Key` and the first admin.
8. **Open it:** browse to `http://<server-ip>/`. The first request takes a few seconds while the database is created. Sign in at `/admin/login` with your phone and password.
9. **Domain:** at your domain registrar add an **A record** for `yourdomain.com` (and `www`) pointing to the server IP. Add the host name to the IIS site binding.
10. **Free SSL (https):** download **win-acme** from https://www.win-acme.com, unzip, run `wacs.exe` as administrator, press `N`, pick the `wbms` site. It installs a Let's Encrypt certificate, adds the https binding and renews it automatically.
11. **Firewall:** in the provider's control panel allow ports 80 and 443 (Windows Firewall allows them once IIS is installed).

Drivers' live location only works on `https://`, so give drivers and customers the https link.

## Option B: Azure App Service

1. In the Azure portal create a **Web App**: publish *Code*, runtime stack **ASP.NET V4.8**, operating system **Windows**, plan **Basic B1** or higher (needed for a custom domain with SSL).
2. Create an **Azure SQL Database** (Basic tier is enough). Under *Networking* allow Azure services to access the server.
3. In the Web App → *Settings* → *Environment variables*:
   - *App settings*: add `Jwt:Key`, `Setup:AdminPhone`, `Setup:AdminPassword`, `Sms:Provider`, the `Msg91:*`, `Razorpay:*` and `Business:*` values (same names as section 2). These override `Web.config`, so you never edit files on Azure.
   - *Connection strings*: name `Wbms`, type **SQLAzure**, value = the ADO.NET connection string of your Azure SQL database (with its password).
4. Upload the site, either way:
   - **From GitHub (no build on your PC):**
     1. Web App → *Settings* → *Configuration* → *General settings*: turn **SCM Basic Auth Publishing Credentials** on and save.
     2. Web App → *Overview* → **Download publish profile**.
     3. In GitHub, repository → *Settings* → *Secrets and variables* → *Actions*:
        - *Secrets* tab → *New repository secret*: name `AZURE_WEBAPP_PUBLISH_PROFILE`, value = the whole content of the downloaded file.
        - *Variables* tab → *New repository variable*: name `AZURE_WEBAPP_NAME`, value = your Web App's name.
     4. Repository → *Actions* → **Deploy to Azure** → *Run workflow*. Run it again whenever you want to publish the latest code.
   - **By hand:** build the package (section 1), then Web App → *Advanced Tools (Kudu)* → *Go* → *Tools* → *Zip Push Deploy*, and drag `publish\wbms-site.zip` onto the `wwwroot` folder.
5. Open `https://<app-name>.azurewebsites.net` and sign in at `/admin/login`.
6. Custom domain: *Custom domains* → *Add custom domain*, follow the DNS steps, then *Add binding* with a free **App Service Managed Certificate**.

## Option C: your own PC or office server

Use **Windows 10/11 Pro** or Windows Server.

1. Turn on IIS: *Control Panel* → *Programs* → *Turn Windows features on or off* → tick *Internet Information Services* and under *World Wide Web Services → Application Development Features* tick **ASP.NET 4.8**.
2. Follow option A from step 3 (SQL Server Express, copy the site, IIS site, SQL login, Web.config).
3. To reach it from the internet: ask your internet provider for a **static IP**, forward ports 80 and 443 on your router to this PC, point your domain's A record at the static IP, then run win-acme (option A step 10).

The PC must stay on and connected for customers to order.

## Updating to a new version

1. Build a new package (section 1).
2. On the server, put a file named `app_offline.htm` (any text, e.g. "Updating, back in a minute") in the site folder. This stops the site and shows that text.
3. Copy the new `bin` and `wwwroot` folders over the old ones. **Keep your `Web.config`** (don't overwrite it).
4. Delete `app_offline.htm`.

On Azure, run the **Deploy to Azure** action again (or zip-deploy the new package); your settings live in the portal and are kept.

## Backups

Back up the database regularly. For SQL Server Express, schedule this in Task Scheduler (daily):

```cmd
sqlcmd -S .\SQLEXPRESS -E -Q "BACKUP DATABASE Wbms TO DISK='C:\Backups\Wbms.bak' WITH INIT"
```

and copy `C:\Backups` somewhere off the server. Azure SQL keeps automatic backups.

## If the site shows an error

- *Server Error / 500 on every page:* the message is shown when you browse the site **on the server itself** (Remote Desktop). Common causes:
  - "Jwt:Key is still the development key" or "Set Jwt:Key": fill in your own key.
  - "Cannot open database" / "Login failed for user IIS APPPOOL\wbms": run step 6 of option A.
  - "Sms:Provider is Msg91 but ... is missing": fill in all three Msg91 values.
- *403 or a directory listing:* the application pool is not .NET v4.0 / Integrated, or ASP.NET 4.8 is not installed (option A step 2).
- After changing `Web.config` the site restarts by itself; there is nothing else to restart.
