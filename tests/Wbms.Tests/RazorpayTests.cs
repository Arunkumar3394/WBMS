using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Wbms.Api.Controllers;
using Wbms.Client;
using Wbms.Client.ViewModels;

namespace Wbms.Tests;

/// <summary>Online payment end to end, with Razorpay's servers faked.</summary>
public class RazorpayTests : IDisposable
{
    private const string WebhookSecret = "whsec_test";

    private class FakeRazorpay : HttpMessageHandler
    {
        public JsonElement? LastBody;
        public string? LastAuth;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastAuth = request.Headers.Authorization?.ToString();
            LastBody = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct)).RootElement.Clone();
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { id = "plink_1", short_url = "https://rzp.io/i/test123" }) };
        }
    }

    private class Factory : ApiTests.Factory
    {
        public FakeRazorpay Razorpay { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<RazorpayOptions>();
                s.AddSingleton(new RazorpayOptions { KeyId = "rzp_test_key", KeySecret = "secret", WebhookSecret = WebhookSecret });
                s.AddHttpClient("razorpay").ConfigurePrimaryHttpMessageHandler(() => Razorpay);
            });
        }
    }

    private readonly Factory factory = new();
    public void Dispose() => factory.Dispose();

    private async Task<WbmsApi> SignIn(string phone)
    {
        var api = new WbmsApi(factory.CreateClient());
        await api.RequestOtpAsync(phone);
        api.UseToken((await api.VerifyAsync(phone, factory.Sms.Last[phone])).Token);
        return api;
    }

    private async Task<HttpResponseMessage> PostWebhook(object payload, string? secret = WebhookSecret)
    {
        var body = JsonSerializer.Serialize(payload);
        var sig = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret!), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/razorpay/webhook") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add("X-Razorpay-Signature", sig);
        return await factory.CreateClient().SendAsync(req);
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

    [Fact]
    public async Task Customer_pays_online_and_order_becomes_paid()
    {
        var api = await SignIn("9000000002");
        var home = new CustomerViewModel(api);
        Uri? opened = null;
        home.OpenPayment += u => opened = u;
        await home.Load();
        home.Quantity = 2;
        home.PaymentChoice = 2;
        await home.BookCommand.ExecuteAsync(null);

        Assert.Null(home.Error);
        Assert.Equal("https://rzp.io/i/test123", opened?.ToString());
        var order = Assert.Single(home.Orders);
        Assert.Equal(OrderStatus.PaymentPending, order.Status);

        // What we sent Razorpay
        var sent = factory.Razorpay.LastBody!.Value;
        Assert.Equal(8000, sent.GetProperty("amount").GetInt64()); // 2 × ₹40 in paise
        Assert.Equal(order.Id.ToString(), sent.GetProperty("notes").GetProperty("wbms_order_id").GetString());
        Assert.StartsWith("Basic ", factory.Razorpay.LastAuth);

        // Razorpay confirms; a repeat delivery of the same event is harmless
        (await PostWebhook(LinkPaid(order.Id, 8000))).EnsureSuccessStatusCode();
        (await PostWebhook(LinkPaid(order.Id, 8000))).EnsureSuccessStatusCode();
        Assert.Equal(OrderStatus.Paid, (await api.OrderAsync(order.Id)).Status);
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
        var api = await SignIn("9000000002");
        var me = await api.MeAsync();
        var products = await api.ProductsAsync();
        var order = await api.BookAsync(new Wbms.Client.BookRequest(me.Addresses[0].Id, PaymentMode.Cash, DateOnly.FromDateTime(DateTime.Today),
            [new OrderLine(products[0].Id, 1)], null));
        var ex = await Assert.ThrowsAsync<ApiException>(() => api.PaymentLinkAsync(order.Id));
        Assert.Contains("doesn't need online payment", ex.Message);
    }
}
