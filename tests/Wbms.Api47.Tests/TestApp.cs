using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Owin.Testing;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Wbms.Api47;
using Wbms.Api47.Data;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;

namespace Wbms.Api47.Tests;

public class SmsInbox : IOtpSender
{
    public readonly Dictionary<string, string> Last = new Dictionary<string, string>();
    public readonly List<string> Codes = new List<string>();
    public Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null)
    {
        lock (Last) { Last[phone] = otp; Codes.Add(otp); }
        return Task.FromResult(0);
    }
}

public static class TestDb
{
    /// <summary>A fresh in-memory database with the demo data.</summary>
    public static WbmsDb Create()
    {
        var db = new WbmsDb(Effort.DbConnectionFactory.CreateTransient(), true);
        SeedData.Ensure(db);
        return db;
    }
}

/// <summary>The whole API in memory, with its own database, so login rate limits and resend gaps don't leak between tests.</summary>
public sealed class TestApp : IDisposable
{
    public SmsInbox Sms { get; } = new SmsInbox();
    public WbmsServices Services { get; }
    private readonly TestServer server;

    public TestApp(Action<WbmsServices>? configure = null)
    {
        var dbId = Guid.NewGuid().ToString();
        Services = new WbmsServices
        {
            CreateDb = () => new WbmsDb(Effort.DbConnectionFactory.CreatePersistent(dbId), true),
            Jwt = new JwtOptions { Key = "test-signing-key-test-signing-key-0123456789" },
            OtpSender = Sms,
            AuthLimiter = new RateLimiter(100),
        };
        configure?.Invoke(Services);
        using (var db = Services.CreateDb()) SeedData.Ensure(db);
        server = TestServer.Create(app => Startup.Configure(app, Services));
    }

    public HttpClient Client() => new HttpClient(server.Handler) { BaseAddress = new Uri("http://localhost/") };

    public async Task<HttpClient> SignIn(string phone)
    {
        var c = Client();
        (await c.PostJson("api/auth/request-otp", new { phone })).EnsureSuccessStatusCode();
        var res = await c.PostJson("api/auth/verify", new { phone, otp = Sms.Last[phone] });
        res.EnsureSuccessStatusCode();
        var token = (string)(await res.ReadJson())["token"]!;
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    public void Dispose() => server.Dispose();
}

public static class HttpExtensions
{
    public static Task<HttpResponseMessage> PostJson(this HttpClient c, string path, object? body = null) =>
        c.PostAsync(path, new StringContent(body == null ? "" : JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json"));

    public static Task<HttpResponseMessage> PutJson(this HttpClient c, string path, object body) =>
        c.PutAsync(path, new StringContent(JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json"));

    public static async Task<JToken> ReadJson(this HttpResponseMessage res) =>
        JToken.Parse(await res.Content.ReadAsStringAsync());

    public static async Task<JToken> GetJson(this HttpClient c, string path)
    {
        var res = await c.GetAsync(path);
        res.EnsureSuccessStatusCode();
        return await res.ReadJson();
    }
}
