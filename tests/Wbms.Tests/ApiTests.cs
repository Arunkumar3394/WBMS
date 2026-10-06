using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Wbms.Core.Services;
using Wbms.Data;

namespace Wbms.Tests;

/// <summary>Each test gets its own app and database, because the login code resend limit is per phone number.</summary>
public class ApiTests : IDisposable
{
    public class SmsInbox : IOtpSender
    {
        public readonly Dictionary<string, string> Last = new();
        public Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null) { lock (Last) Last[phone] = otp; return Task.CompletedTask; }
    }

    public class Factory : WebApplicationFactory<Program>
    {
        public SmsInbox Sms { get; } = new();
        private readonly string dbName = Guid.NewGuid().ToString();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureServices(s =>
            {
                s.RemoveAll<DbContextOptions<WbmsDbContext>>();
                s.AddDbContext<WbmsDbContext>(o => o.UseInMemoryDatabase(dbName));
                s.RemoveAll<IOtpSender>();
                s.AddSingleton<IOtpSender>(Sms);
            });
        }
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };
    private readonly Factory factory = new();
    public void Dispose() => factory.Dispose();

    private async Task<HttpClient> SignIn(string phone)
    {
        var c = factory.CreateClient();
        (await c.PostAsJsonAsync("/api/auth/request-otp", new { phone })).EnsureSuccessStatusCode();
        var res = await c.PostAsJsonAsync("/api/auth/verify", new { phone, otp = factory.Sms.Last[phone] });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    [Fact]
    public async Task Endpoints_require_sign_in()
    {
        var res = await factory.CreateClient().GetAsync("/api/orders");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Wrong_login_code_is_rejected()
    {
        var c = factory.CreateClient();
        await c.PostAsJsonAsync("/api/auth/request-otp", new { phone = "9000000001" });
        var wrong = factory.Sms.Last["9000000001"] == "0000" ? "1111" : "0000";
        var res = await c.PostAsJsonAsync("/api/auth/verify", new { phone = "9000000001", otp = wrong });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Full_flow_through_the_api_with_roles()
    {
        var customer = await SignIn("9000000002");
        var admin = await SignIn("9000000000");
        var driver = await SignIn("9000000001");

        var me = await customer.GetFromJsonAsync<JsonElement>("/api/me", Json);
        var addressId = me.GetProperty("addresses")[0].GetProperty("id").GetInt32();
        var products = await customer.GetFromJsonAsync<JsonElement>("/api/products", Json);
        var canId = products.EnumerateArray().First(p => p.GetProperty("isReturnable").GetBoolean()).GetProperty("id").GetInt32();

        var booked = await customer.PostAsJsonAsync("/api/orders", new
        {
            addressId, paymentMode = "Cash", slotDate = DateOnly.FromDateTime(DateTime.Today), items = new[] { new { productId = canId, qty = 3 } }
        }, Json);
        booked.EnsureSuccessStatusCode();
        var orderId = (await booked.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("id").GetInt32();

        // Only staff can confirm
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.PostAsync($"/api/orders/{orderId}/confirm", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.PostAsync($"/api/orders/{orderId}/confirm", null)).StatusCode);
        (await admin.PostAsync($"/api/orders/{orderId}/confirm", null)).EnsureSuccessStatusCode();

        var drivers = await admin.GetFromJsonAsync<JsonElement>("/api/drivers", Json);
        var driverId = drivers[0].GetProperty("id").GetInt32();
        (await admin.PostAsJsonAsync($"/api/orders/{orderId}/assign", new { driverId })).EnsureSuccessStatusCode();

        // Driver sees the order, starts it, the customer gets the delivery OTP
        var mine = await driver.GetFromJsonAsync<JsonElement>("/api/orders", Json);
        Assert.Contains(mine.EnumerateArray(), o => o.GetProperty("id").GetInt32() == orderId);
        (await driver.PostAsync($"/api/orders/{orderId}/start", null)).EnsureSuccessStatusCode();
        (await driver.PostAsJsonAsync($"/api/orders/{orderId}/location", new { lat = 13.08, lng = 80.27 })).EnsureSuccessStatusCode();
        var deliveryOtp = factory.Sms.Last["9000000002"];

        var done = await driver.PostAsJsonAsync($"/api/orders/{orderId}/complete",
            new { otp = deliveryOtp, fullCansDelivered = 3, emptyCansCollected = 3, cashCollected = 120 });
        done.EnsureSuccessStatusCode();
        var order = await done.Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal("Completed", order.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(order.GetProperty("invoiceNo").GetString()));

        // Customer downloads the invoice PDF
        var invoices = await customer.GetFromJsonAsync<JsonElement>($"/api/customers/{me.GetProperty("customerId").GetInt32()}/invoices", Json);
        var invoiceId = invoices[0].GetProperty("id").GetInt32();
        var pdf = await customer.GetAsync($"/api/invoices/{invoiceId}/pdf");
        pdf.EnsureSuccessStatusCode();
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
        var bytes = await pdf.Content.ReadAsByteArrayAsync();
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));

        // A driver can't download a customer's invoice
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.GetAsync($"/api/invoices/{invoiceId}/pdf")).StatusCode);
    }

    [Fact]
    public async Task Customer_cannot_see_someone_elses_order_or_invoices()
    {
        var admin = await SignIn("9000000000");
        var other = await admin.PostAsJsonAsync("/api/customers", new
        {
            name = "Other", phone = "9111111111", type = "Shop", creditLimit = 0, addressLine = "1 Street", area = "Area"
        }, Json);
        other.EnsureSuccessStatusCode();
        var otherId = (await other.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("id").GetInt32();

        var customer = await SignIn("9000000002");
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync($"/api/customers/{otherId}/invoices")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/customers")).StatusCode);
    }
}
