using System.IO;
using System.Net.Http.Formatting;
using System.Threading.Tasks;
using System.Web.Http;
using Microsoft.Owin;
using Microsoft.Owin.FileSystems;
using Microsoft.Owin.Security;
using Microsoft.Owin.Security.Jwt;
using Microsoft.Owin.StaticFiles;
using Microsoft.IdentityModel.Tokens;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Owin;
using Wbms.Api47.Infrastructure;

namespace Wbms.Api47;

public static class Startup
{
    public static void Configure(IAppBuilder app, WbmsServices services)
    {
        app.UseJwtBearerAuthentication(new JwtBearerAuthenticationOptions
        {
            AuthenticationMode = AuthenticationMode.Active,
            TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = services.Jwt.Issuer,
                ValidAudience = services.Jwt.Audience,
                IssuerSigningKey = services.Jwt.SigningKey(),
            }
        });

        if (services.WebRoot != null && Directory.Exists(services.WebRoot))
            UseAngularSite(app, services.WebRoot);

        app.UseWebApi(CreateWebApiConfig(services));
    }

    public static HttpConfiguration CreateWebApiConfig(WbmsServices services)
    {
        var config = new HttpConfiguration();
        services.AttachTo(config);
        config.MapHttpAttributeRoutes();

        // JSON only: camelCase names, enums as strings, UTC times with a trailing Z.
        config.Formatters.Clear();
        config.Formatters.Add(new JsonMediaTypeFormatter
        {
            SerializerSettings = new JsonSerializerSettings
            {
                ContractResolver = new CamelCasePropertyNamesContractResolver(),
                Converters = { new StringEnumConverter() },
                DateTimeZoneHandling = DateTimeZoneHandling.Utc,
                ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            }
        });

        // Every endpoint needs a signed-in user unless it says [AllowAnonymous].
        config.Filters.Add(new AuthorizeAttribute());
        config.Filters.Add(new RequireBodyFilter());
        config.Filters.Add(new WorkflowExceptionFilter());
        config.IncludeErrorDetailPolicy = IncludeErrorDetailPolicy.Never;
        return config;
    }

    /// <summary>Serves the built Angular app; unknown non-API paths get index.html so deep links work.</summary>
    private static void UseAngularSite(IAppBuilder app, string webRoot)
    {
        var fileSystem = new PhysicalFileSystem(webRoot);
        app.Use(async (IOwinContext ctx, System.Func<Task> next) =>
        {
            var path = ctx.Request.Path.Value ?? "/";
            if (ctx.Request.Method == "GET" && !path.StartsWith("/api/") && path != "/api" &&
                !Path.HasExtension(path) && !fileSystem.TryGetFileInfo(path, out _))
                ctx.Request.Path = new PathString("/index.html");
            await next();
        });
        app.UseFileServer(new FileServerOptions { FileSystem = fileSystem, EnableDefaultFiles = true });
    }
}
