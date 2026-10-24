using System;
using System.Net;
using System.Web.Hosting;
using Microsoft.Owin;
using Owin;
using Wbms.Api47.Infrastructure;

[assembly: OwinStartup(typeof(Wbms.Api47.IisStartup))]

namespace Wbms.Api47;

/// <summary>
/// Entry point when the site runs under IIS or Azure App Service (the package from deploy\make-package.cmd).
/// Settings come from Web.config, or from environment variables / App Service application settings.
/// </summary>
public class IisStartup
{
    /// <summary>The key shipped in App.config for local development; a public site must never use it.</summary>
    public const string DevJwtKey = "dev-only-wbms-signing-key-change-me-0123456789";

    public void Configuration(IAppBuilder app)
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;

        var services = WbmsServices.FromConfig();
        if (services.Jwt.Key == DevJwtKey)
            throw new InvalidOperationException("Jwt:Key is still the development key. Set your own random key (32+ characters) in Web.config.");
        services.WebRoot = HostingEnvironment.MapPath("~/wwwroot");

        Program.PrepareDatabase(services);
        Startup.Configure(app, services);
    }
}
