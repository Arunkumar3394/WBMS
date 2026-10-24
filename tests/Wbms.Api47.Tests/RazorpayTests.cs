using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Wbms.Api47.Services;
using Xunit;

namespace Wbms.Api47.Tests;

/// <summary>Online payment end to end, with Razorpay's servers faked.</summary>
public class RazorpayTests : IDisposable
{
    private const string WebhookSecret = "whsec_test";

    private class FakeRazorpay : HttpMessageHandler
    {
        public JObject? LastBody;
        public string? LastAuth;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastAuth = request.Headers.Authorization?.ToString();
            LastBody = JObject.Parse(await request.Content!.ReadAsStringAsync());
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"id\":\"plink_1\",\"short_url\":\"https://rzp.io/i/test123\"}") };
        }
    }

    private readonly FakeRazorpay razorpay = new FakeRazorpay();
    private readonly TestApp app;

    public RazorpayTests()
    {
        app = new TestApp(s =>
        {
            s.Razorpay = new RazorpayOptions { KeyId = "rzp_test_key", KeySecret = "secret", WebhookSecret = WebhookSecret, CallbackUrl = "https://shop.example/orders/{orderId}" };
            s.Http = new HttpClient(razorpay);
        });
    }

    public void Dispose() => app.Dispose();

    private async Task<HttpResponseMessage> PostWebhook(object payload, string secret = WebhookSecret)
    {
        var body = JsonConvert.SerializeObject(payload);
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var sig = BitConverter.ToString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).Replace("-", "").ToLowerInvariant();
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/razorpay/webhook") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add("X-Razorpay-Signature", sig);
        return await app.Client().SendAsync(req);
    }

    private static object LinkPaid(int orderId, long paise) => new
    {
        @event = "payment_link.paid",
        payload = new
        {
            payment_link = new { entity = new { id = "plink_1", notes = new { wbms_order_id = orderId.ToString() } } },
            payment = new { entity = new { id = "pay_123", amount = paise, notes = new { } } }
        }
    };

    private async Task<(HttpClient customer, int orderId)> BookOnline(string mode = "Razorpay")
    {
        var customer = await app.SignIn("9000000002");
        var me = await customer.GetJson("api/me");
        var can = (await customer.GetJson("api/products")).First(p => (bool)p["isReturnable"]!);
        var res = await customer.PostJson("api/orders", new
        {
            addressId = (int)me["addresses"]![0]!["id"]!, paymentMode = mode, slotDate = DateTime.Today.ToString("yyyy-MM-dd"),
            items = new[] { new { productId = (int)can["id"]!, qty = 2 } }
        });
        res.EnsureSuccessStatusCode();
        return (customer, (int)(await res.ReadJson())["id"]!);
    }

    [Fact]
    public async Task Customer_pays_online_and_order_becomes_paid()
    {
        var (customer, orderId) = await BookOnline();
        var link = await customer.PostJson($"api/orders/{orderId}/payment-link");
        link.EnsureSuccessStatusCode();
        Assert.Equal("https://rzp.io/i/test123", (string)(await link.ReadJson())["url"]!);

        // What we sent Razorpay
        var sent = razorpay.LastBody!;
        Assert.Equal(8000, (long)sent["amount"]!); // 2 × ₹40 in paise
        Assert.Equal(orderId.ToString(), (string)sent["notes"]!["wbms_order_id"]!);
        Assert.Equal($"https://shop.example/orders/{orderId}", (string)sent["callback_url"]!);
        Assert.StartsWith("Basic ", razorpay.LastAuth);

        // Razorpay confirms; a repeat delivery of the same event is harmless
        (await PostWebhook(LinkPaid(orderId, 8000))).EnsureSuccessStatusCode();
        (await PostWebhook(LinkPaid(orderId, 8000))).EnsureSuccessStatusCode();
        Assert.Equal("Paid", (string)(await customer.GetJson($"api/orders/{orderId}"))["status"]!);
    }

    [Fact]
    public async Task Webhook_with_bad_signature_is_rejected()
    {
        var res = await PostWebhook(LinkPaid(1, 100), secret: "wrong");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Cash_order_cannot_get_a_payment_link()
    {
        var (customer, orderId) = await BookOnline("Cash");
        var res = await customer.PostJson($"api/orders/{orderId}/payment-link");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("doesn't need online payment", (string)(await res.ReadJson())["error"]!);
    }
}

public class SmsTests
{
    private class Recorder : HttpMessageHandler
    {
        private readonly HttpStatusCode status;
        public HttpRequestMessage? Request;
        public string? Body;
        public Recorder(HttpStatusCode status) => this.status = status;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Body = await request.Content!.ReadAsStringAsync();
            return new HttpResponseMessage(status) { Content = new StringContent("{\"type\":\"error\"}") };
        }
    }

    private static readonly Msg91Options Options = new Msg91Options { AuthKey = "key123", LoginTemplateId = "tpl-login", DeliveryTemplateId = "tpl-delivery" };

    [Fact]
    public async Task Delivery_code_uses_delivery_template_with_country_code_and_order()
    {
        var h = new Recorder(HttpStatusCode.OK);
        await new Msg91OtpSender(new HttpClient(h), Options).SendAsync("9000000002", "4821", OtpPurpose.Delivery, "WB123");

        Assert.Equal(Msg91OtpSender.Endpoint, h.Request!.RequestUri!.ToString());
        Assert.Equal("key123", h.Request.Headers.GetValues("authkey").Single());
        var body = JObject.Parse(h.Body!);
        Assert.Equal("tpl-delivery", (string)body["template_id"]!);
        var r = body["recipients"]![0]!;
        Assert.Equal("919000000002", (string)r["mobiles"]!);
        Assert.Equal("4821", (string)r["otp"]!);
        Assert.Equal("WB123", (string)r["order"]!);
    }

    [Fact]
    public async Task Provider_error_becomes_a_friendly_message()
    {
        var sender = new Msg91OtpSender(new HttpClient(new Recorder(HttpStatusCode.Unauthorized)), Options);
        var ex = await Assert.ThrowsAsync<Infrastructure.WorkflowException>(() => sender.SendAsync("9000000002", "1111", OtpPurpose.Login));
        Assert.Contains("Couldn't send the SMS", ex.Message);
    }
}
