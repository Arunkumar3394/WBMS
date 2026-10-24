using System;
using System.Configuration;
using System.Diagnostics;
using System.Threading;
using AquaPure.Api.Infrastructure;
using Microsoft.Owin.Hosting;

namespace AquaPure.Api
{
    public static class Program
    {
        public static int Main()
        {
            Trace.Listeners.Add(new ConsoleTraceListener());
            Settings settings;
            try
            {
                settings = Settings.Load();
            }
            catch (ConfigurationErrorsException ex)
            {
                Console.Error.WriteLine("Configuration error: " + ex.Message);
                return 1;
            }

            var services = AppServices.Create(settings);
            using (WebApp.Start(settings.ApiUrl, app => new Startup(services).Configuration(app)))
            {
                Console.WriteLine("AquaPure API running at " + settings.ApiUrl);
                Console.WriteLine(settings.RazorpayConfigured
                    ? "Razorpay: " + (settings.RazorpayKeyId.StartsWith("rzp_live_") ? "LIVE mode" : "test mode")
                    : "Razorpay: not configured (online payment disabled)");
                Console.WriteLine("Press Ctrl+C to stop.");

                var stop = new ManualResetEventSlim();
                Console.CancelKeyPress += (s, e) => { e.Cancel = true; stop.Set(); };
                stop.Wait();
            }
            return 0;
        }
    }
}
