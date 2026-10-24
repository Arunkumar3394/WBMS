using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Http;
using System.Web.Http.Cors;
using System.Web.Http.Dependencies;
using System.Web.Http.ExceptionHandling;
using AquaPure.Api.Auth;
using AquaPure.Api.Controllers;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Payments;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Owin;

namespace AquaPure.Api
{
    /// <summary>The services shared by every request.</summary>
    public class AppServices
    {
        public Settings Settings { get; set; }
        public Db Db { get; set; }
        public SupabaseJwtValidator Jwt { get; set; }
        /// <summary>Null when Razorpay keys are not configured (online payment is then unavailable).</summary>
        public RazorpayClient Razorpay { get; set; }

        public static AppServices Create(Settings settings) => new AppServices
        {
            Settings = settings,
            Db = new Db(settings.DbConnection),
            Jwt = new SupabaseJwtValidator(settings.SupabaseUrl, settings.SupabaseJwtSecret),
            Razorpay = settings.RazorpayConfigured ? new RazorpayClient(settings.RazorpayKeyId, settings.RazorpayKeySecret) : null,
        };
    }

    public class Startup
    {
        private readonly AppServices _services;

        public Startup(AppServices services) { _services = services; }

        public void Configuration(IAppBuilder app)
        {
            var config = new HttpConfiguration();
            Configure(config, _services);
            app.UseWebApi(config);
        }

        public static void Configure(HttpConfiguration config, AppServices services)
        {
            config.MapHttpAttributeRoutes();
            config.DependencyResolver = new Resolver(services);

            // JSON in and out uses snake_case, like the database.
            config.Formatters.Remove(config.Formatters.XmlFormatter);
            var json = config.Formatters.JsonFormatter.SerializerSettings;
            json.ContractResolver = new DefaultContractResolver { NamingStrategy = new SnakeCaseNamingStrategy() };
            json.NullValueHandling = NullValueHandling.Include;
            json.DateParseHandling = DateParseHandling.None;
            json.MaxDepth = 32;

            if (services.Settings.AllowedOrigins.Length > 0)
                config.EnableCors(new EnableCorsAttribute(string.Join(",", services.Settings.AllowedOrigins),
                    "Authorization,Content-Type,Idempotency-Key", "GET,POST,PUT,DELETE") { PreflightMaxAge = 600 });

            config.MessageHandlers.Add(new SecurityHeadersHandler());
            config.MessageHandlers.Add(new AuthHandler(services.Jwt));
            config.Filters.Add(new ValidateModelAttribute());
            config.Services.Replace(typeof(IExceptionHandler), new JsonExceptionHandler());
            config.Services.Add(typeof(IExceptionLogger), new TraceExceptionLogger());
            config.IncludeErrorDetailPolicy = IncludeErrorDetailPolicy.Never;

            config.EnsureInitialized();
        }
    }

    /// <summary>Hands the shared services to controllers and filters (no container needed).</summary>
    public class Resolver : IDependencyResolver
    {
        private readonly AppServices _s;
        public Resolver(AppServices services) { _s = services; }

        public object GetService(Type t)
        {
            if (t == typeof(Db)) return _s.Db;
            if (t == typeof(Settings)) return _s.Settings;
            if (typeof(ApiControllerBase).IsAssignableFrom(t))
            {
                var c = (ApiControllerBase)Activator.CreateInstance(t);
                c.Services = _s;
                return c;
            }
            return null;
        }

        public IEnumerable<object> GetServices(Type t) => Enumerable.Empty<object>();
        public IDependencyScope BeginScope() => this;
        public void Dispose() { }
    }
}
