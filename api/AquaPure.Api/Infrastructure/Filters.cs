using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Http.Controllers;
using System.Web.Http.Filters;
using AquaPure.Api.Auth;

namespace AquaPure.Api.Infrastructure
{
    /// <summary>
    /// Limits how often one user (or, for visitors, one IP address) can call an endpoint.
    /// Counters live in Postgres (app.check_rate_limit), so they hold across API restarts and servers.
    /// </summary>
    [AttributeUsage(AttributeTargets.Method)]
    public class RateLimitAttribute : ActionFilterAttribute
    {
        private readonly string _name;
        private readonly int _max;
        private readonly int _windowSeconds;

        public RateLimitAttribute(string name, int max, int windowSeconds)
        {
            _name = name;
            _max = max;
            _windowSeconds = windowSeconds;
        }

        public override async Task OnActionExecutingAsync(HttpActionContext context, CancellationToken cancellationToken)
        {
            var resolver = context.ControllerContext.Configuration.DependencyResolver;
            var db = (Db)resolver.GetService(typeof(Db));
            var settings = (Settings)resolver.GetService(typeof(Settings));
            var user = context.Request.GetUser();
            var who = user != null ? "user:" + user.Id : "ip:" + ClientIp.Get(context.Request, settings.TrustProxy);

            var ok = await db.AsSystem(s => s.Scalar<bool>("select app.check_rate_limit(@key, @max, @window)",
                new { key = _name + ":" + who, max = _max, window = _windowSeconds }));
            if (!ok)
                throw new ApiException((HttpStatusCode)429, "Too many requests. Please wait a few minutes and try again.");
        }
    }

    /// <summary>Rejects a request whose body is missing or fails its [Required]/[Range]/... rules.</summary>
    public class ValidateModelAttribute : ActionFilterAttribute
    {
        public override void OnActionExecuting(HttpActionContext context)
        {
            foreach (var p in context.ActionDescriptor.GetParameters())
            {
                if (p.ParameterBinderAttribute is System.Web.Http.FromBodyAttribute ||
                    (!p.ParameterType.IsValueType && p.ParameterType != typeof(string)))
                {
                    if (context.ActionArguments.TryGetValue(p.ParameterName, out var v) && v == null)
                        throw new ApiException(HttpStatusCode.BadRequest, "The request is missing its details.");
                }
            }
            if (!context.ModelState.IsValid)
            {
                var first = context.ModelState.Values.SelectMany(m => m.Errors)
                    .Select(e => !string.IsNullOrEmpty(e.ErrorMessage) ? e.ErrorMessage : "Some of the details are not valid.")
                    .FirstOrDefault();
                throw new ApiException(HttpStatusCode.BadRequest, first ?? "Some of the details are not valid.");
            }
        }
    }

    public static class ClientIp
    {
        public static string Get(HttpRequestMessage request, bool trustProxy)
        {
            if (trustProxy && request.Headers.TryGetValues("X-Forwarded-For", out var values))
            {
                // The last address was added by our own proxy (IIS); earlier ones can be forged by the client.
                var last = values.SelectMany(v => v.Split(',')).Select(v => v.Trim()).LastOrDefault(v => v.Length > 0);
                if (!string.IsNullOrEmpty(last)) return last;
            }
            if (request.Properties.TryGetValue("MS_OwinContext", out var ctx) && ctx is Microsoft.Owin.IOwinContext owin)
                return owin.Request.RemoteIpAddress ?? "unknown";
            return "unknown";
        }
    }

    /// <summary>Basic security headers on every response.</summary>
    public class SecurityHeadersHandler : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = await base.SendAsync(request, cancellationToken);
            response.Headers.TryAddWithoutValidation("X-Content-Type-Options", "nosniff");
            response.Headers.TryAddWithoutValidation("X-Frame-Options", "DENY");
            response.Headers.TryAddWithoutValidation("Referrer-Policy", "no-referrer");
            response.Headers.CacheControl = response.Headers.CacheControl ?? new System.Net.Http.Headers.CacheControlHeaderValue { NoStore = true };
            return response;
        }
    }
}
