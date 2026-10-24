using System;
using System.IO;
using System.Net;
using System.Threading;
using Microsoft.Owin.Hosting;
using Wbms.Api47.Data;
using Wbms.Api47.Infrastructure;

namespace Wbms.Api47;

public static class Program
{
    public static int Main()
    {
        // Razorpay and MSG91 require TLS 1.2.
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;

        WbmsServices services;
        try { services = WbmsServices.FromConfig(); }
        catch (InvalidOperationException ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
        services.WebRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wwwroot");

        PrepareDatabase(services);

        var url = AppConfig.Get("Web:Url", "http://localhost:5080/");
        using (WebApp.Start(url, app => Startup.Configure(app, services)))
        {
            Console.WriteLine($"WBMS API running at {url} (press Ctrl+C to stop)");
            var stop = new ManualResetEvent(false);
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
            stop.WaitOne();
        }
        return 0;
    }

    /// <summary>Creates the database on first run and adds the demo data or the first admin when configured. Shared with <see cref="IisStartup"/>.</summary>
    public static void PrepareDatabase(WbmsServices services)
    {
        using var db = services.CreateDb();
        db.Database.Initialize(false);
        if (AppConfig.GetBool("Seed:DemoData", false)) SeedData.Ensure(db);
        SeedData.EnsureFirstAdmin(db, AppConfig.Get("Setup:AdminPhone"), AppConfig.Get("Setup:AdminPassword"));
    }
}
