using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AquaPure.Api.Auth;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Payments;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Owin.Testing;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Xunit;

namespace AquaPure.Api.Tests.Integration
{
    /// <summary>
    /// Runs the real API in memory against the real database scripts (served by PGlite over the
    /// Postgres protocol, see database/tests/serve.mjs). Only Razorpay is faked.
    /// Needs Node.js and `npm install` in the database folder.
    /// </summary>
    public sealed class ApiFixture : IDisposable
    {
        public static readonly Guid Customer = Guid.Parse("00000000-0000-4000-8000-000000000001");
        public static readonly Guid OtherCustomer = Guid.Parse("00000000-0000-4000-8000-000000000002");
        public static readonly Guid Staff = Guid.Parse("00000000-0000-4000-8000-000000000003");
        public static readonly Guid Admin = Guid.Parse("00000000-0000-4000-8000-000000000004");

        public const string SupabaseUrl = "https://test-project.supabase.co";
        public const string RazorpayKeySecret = "rzp_test_secret";
        public const string WebhookSecret = "whsec_test";

        private readonly Process _db;
        private readonly ECDsaSecurityKey _signingKey = new ECDsaSecurityKey(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = "test-key" };

        public TestServer Server { get; }
        public FakeRazorpay Razorpay { get; } = new FakeRazorpay();

        public ApiFixture()
        {
            var port = 54400 + new Random().Next(0, 500);
            _db = StartDatabase(port);

            // Server errors (logged via Trace) go to bin/.../api-errors.log for debugging failed tests.
            var log = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "api-errors.log");
            File.Delete(log);
            Trace.Listeners.Add(new TextWriterTraceListener(log));
            Trace.AutoFlush = true;

            var settings = new Settings
            {
                ApiUrl = "http://localhost/",
                AllowedOrigins = new[] { "http://localhost:4200" },
                SupabaseUrl = SupabaseUrl,
                DbConnection = $"Host=127.0.0.1;Port={port};Username=wbms_api;Database=postgres;Maximum Pool Size=1;SSL Mode=Disable;Timeout=30",
                RazorpayKeyId = "rzp_test_key",
                RazorpayKeySecret = RazorpayKeySecret,
                RazorpayWebhookSecret = WebhookSecret,
            };
            var services = new AppServices
            {
                Settings = settings,
                Db = new Db(settings.DbConnection),
                Jwt = new SupabaseJwtValidator(SupabaseUrl, null, _ => Task.FromResult(Jwks())),
                Razorpay = new RazorpayClient(settings.RazorpayKeyId, settings.RazorpayKeySecret, Razorpay),
            };
            Server = TestServer.Create(app => new Startup(services).Configuration(app));
        }

        public HttpClient Client(Guid? user = null)
        {
            var client = Server.HttpClient;
            client.DefaultRequestHeaders.Authorization = user == null ? null : new AuthenticationHeaderValue("Bearer", Token(user.Value));
            return client;
        }

        public string Token(Guid user, DateTime? expires = null)
        {
            var exp = expires ?? DateTime.UtcNow.AddHours(1);
            return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = SupabaseUrl + "/auth/v1",
                Audience = "authenticated",
                IssuedAt = exp.AddHours(-1),
                NotBefore = exp.AddHours(-1),
                Expires = exp,
                SigningCredentials = new SigningCredentials(_signingKey, SecurityAlgorithms.EcdsaSha256),
                Claims = new Dictionary<string, object> { ["sub"] = user.ToString(), ["role"] = "authenticated" },
            });
        }

        private string Jwks()
        {
            var p = _signingKey.ECDsa.ExportParameters(false);
            return JsonConvert.SerializeObject(new
            {
                keys = new[] { new { kty = "EC", crv = "P-256", alg = "ES256", use = "sig", kid = _signingKey.KeyId,
                                     x = Base64UrlEncoder.Encode(p.Q.X), y = Base64UrlEncoder.Encode(p.Q.Y) } },
            });
        }

        private static Process StartDatabase(int port)
        {
            var dir = AppDomain.CurrentDomain.BaseDirectory;
            while (dir != null && !File.Exists(Path.Combine(dir, "AquaPure.sln"))) dir = Path.GetDirectoryName(dir);
            if (dir == null) throw new InvalidOperationException("Could not find the repository root (AquaPure.sln).");
            var dbDir = Path.Combine(dir, "database");
            if (!Directory.Exists(Path.Combine(dbDir, "node_modules")))
                throw new InvalidOperationException("Run `npm install` in the database folder before the integration tests.");

            var process = new Process
            {
                StartInfo = new ProcessStartInfo("node", "tests/serve.mjs " + port)
                {
                    WorkingDirectory = dbDir,
                    UseShellExecute = false,
                    RedirectStandardInput = true,   // closing it stops the server
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                },
            };
            var ready = new ManualResetEventSlim();
            var errors = new StringBuilder();
            process.OutputDataReceived += (s, e) => { if (e.Data == "READY") ready.Set(); };
            process.ErrorDataReceived += (s, e) => { if (e.Data != null) errors.AppendLine(e.Data); };
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            if (!ready.Wait(TimeSpan.FromSeconds(90)))
            {
                try { process.Kill(); } catch { }
                throw new InvalidOperationException("Test database did not start: " + errors);
            }
            return process;
        }

        public void Dispose()
        {
            Server.Dispose();
            try
            {
                _db.StandardInput.Close();
                if (!_db.WaitForExit(5000)) _db.Kill();
            }
            catch { }
        }
    }

    [CollectionDefinition("api")]
    public class ApiCollection : ICollectionFixture<ApiFixture> { }

    /// <summary>Stands in for api.razorpay.com: creates orders and returns whatever payments a test sets up.</summary>
    public class FakeRazorpay : HttpMessageHandler
    {
        public readonly List<long> CreatedOrderAmounts = new List<long>();
        public readonly Dictionary<string, JObject> Payments = new Dictionary<string, JObject>();
        private int _next;

        public void AddPayment(string paymentId, string razorpayOrderId, long amountPaise, string status = "captured") =>
            Payments[paymentId] = new JObject
            {
                ["id"] = paymentId, ["order_id"] = razorpayOrderId, ["amount"] = amountPaise,
                ["currency"] = "INR", ["status"] = status, ["method"] = "upi",
            };

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri.AbsolutePath;
            if (request.Method == HttpMethod.Post && path == "/v1/orders")
            {
                var body = JObject.Parse(await request.Content.ReadAsStringAsync());
                CreatedOrderAmounts.Add((long)body["amount"]);
                return Json(new JObject { ["id"] = "order_T" + Interlocked.Increment(ref _next) + "_" + Guid.NewGuid().ToString("N").Substring(0, 6), ["amount"] = body["amount"], ["status"] = "created" });
            }
            if (request.Method == HttpMethod.Get && path.StartsWith("/v1/payments/"))
            {
                var id = path.Substring("/v1/payments/".Length);
                return Payments.TryGetValue(id, out var p) ? Json(p) : new HttpResponseMessage(HttpStatusCode.NotFound);
            }
            return new HttpResponseMessage(HttpStatusCode.BadRequest);
        }

        private static HttpResponseMessage Json(JObject o) =>
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(o.ToString(), Encoding.UTF8, "application/json") };
    }

    public static class HttpExtensions
    {
        public static async Task<(HttpStatusCode Status, JToken Body)> Send(this HttpClient client, HttpMethod method, string url, object body = null)
        {
            var request = new HttpRequestMessage(method, url);
            if (body != null)
                request.Content = new StringContent(body is string s ? s : JsonConvert.SerializeObject(body), Encoding.UTF8, "application/json");
            var response = await client.SendAsync(request);
            var text = await response.Content.ReadAsStringAsync();
            return (response.StatusCode, string.IsNullOrEmpty(text) ? null : JToken.Parse(text));
        }

        public static Task<(HttpStatusCode Status, JToken Body)> Get(this HttpClient c, string url) => c.Send(HttpMethod.Get, url);
        public static Task<(HttpStatusCode Status, JToken Body)> Post(this HttpClient c, string url, object body = null) => c.Send(HttpMethod.Post, url, body ?? new { });
        public static Task<(HttpStatusCode Status, JToken Body)> Put(this HttpClient c, string url, object body) => c.Send(HttpMethod.Put, url, body);
    }
}
