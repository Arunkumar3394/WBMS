using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Web.Http.Controllers;
using System.Web.Http.Filters;

namespace Wbms.Api47.Infrastructure;

/// <summary>Business-rule violations become 400s with a readable message; anything else is a 500.</summary>
public class WorkflowExceptionFilter : ExceptionFilterAttribute
{
    public override void OnException(HttpActionExecutedContext ctx)
    {
        if (ctx.Exception is WorkflowException ex)
            ctx.Response = ctx.Request.CreateResponse(HttpStatusCode.BadRequest, new { error = ex.Message });
        else
        {
            Console.Error.WriteLine($"[ERROR] {ctx.Request.Method} {ctx.Request.RequestUri}: {ctx.Exception}");
            ctx.Response = ctx.Request.CreateResponse(HttpStatusCode.InternalServerError, new { error = "Unexpected error." });
        }
    }
}

/// <summary>A missing or unreadable JSON body is a 400, not a crash inside the action.</summary>
public class RequireBodyFilter : ActionFilterAttribute
{
    public override void OnActionExecuting(HttpActionContext ctx)
    {
        var missing = ctx.ActionDescriptor.GetParameters()
            .Where(p => p.ParameterBinderAttribute is null && !p.ParameterType.IsValueType && p.ParameterType != typeof(string) && !p.IsOptional)
            .Any(p => !ctx.ActionArguments.TryGetValue(p.ParameterName, out var v) || v is null);
        if (missing)
            ctx.Response = ctx.Request.CreateResponse(HttpStatusCode.BadRequest, new { error = "Request body is missing or invalid." });
    }
}

/// <summary>Slows down OTP guessing and SMS spam: a fixed number of calls per minute per IP address.</summary>
public class RateLimiter
{
    private readonly int perMinute;
    private readonly ConcurrentDictionary<string, (DateTime WindowStart, int Count)> windows = new ConcurrentDictionary<string, (DateTime, int)>();

    public RateLimiter(int perMinute) => this.perMinute = perMinute;

    public bool Allow(string key)
    {
        var now = DateTime.UtcNow;
        var w = windows.AddOrUpdate(key, _ => (now, 1),
            (_, old) => now - old.WindowStart >= TimeSpan.FromMinutes(1) ? (now, 1) : (old.WindowStart, old.Count + 1));
        if (windows.Count > 10_000) // forget stale callers
            foreach (var stale in windows.Where(kv => now - kv.Value.WindowStart > TimeSpan.FromMinutes(2)).Select(kv => kv.Key).ToList())
                windows.TryRemove(stale, out _);
        return w.Count <= perMinute;
    }
}

public class RateLimitAttribute : ActionFilterAttribute
{
    public override void OnActionExecuting(HttpActionContext ctx)
    {
        var ip = ctx.Request.GetOwinContext()?.Request.RemoteIpAddress ?? "unknown";
        if (!WbmsServices.From(ctx.Request).AuthLimiter.Allow(ip))
            ctx.Response = ctx.Request.CreateResponse((HttpStatusCode)429, new { error = "Too many tries. Please wait a minute." });
    }
}
