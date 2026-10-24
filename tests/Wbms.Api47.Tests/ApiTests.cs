using System;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Xunit;

namespace Wbms.Api47.Tests;

public class ApiTests : IDisposable
{
    private readonly TestApp app = new TestApp();
    public void Dispose() => app.Dispose();

    private static string Today => DateTime.Today.ToString("yyyy-MM-dd");

    private async Task<int> BookCans(System.Net.Http.HttpClient customer, int qty, string paymentMode = "Cash")
    {
        var me = await customer.GetJson("api/me");
        var products = await customer.GetJson("api/products");
        var canId = (int)products.First(p => (bool)p["isReturnable"]!)["id"]!;
        var booked = await customer.PostJson("api/orders", new
        {
            addressId = (int)me["addresses"]![0]!["id"]!, paymentMode, slotDate = Today, items = new[] { new { productId = canId, qty } }
        });
        Assert.Equal(HttpStatusCode.OK, booked.StatusCode);
        return (int)(await booked.ReadJson())["id"]!;
    }

    [Fact]
    public async Task Root_explains_how_to_add_the_website_when_it_is_not_built()
    {
        Assert.Contains("npm run build", await app.Client().GetStringAsync(""));
    }

    [Fact]
    public async Task Endpoints_require_sign_in()
    {
        var res = await app.Client().GetAsync("api/orders");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Wrong_login_code_is_rejected()
    {
        var c = app.Client();
        await c.PostJson("api/auth/request-otp", new { phone = "9000000001" });
        var wrong = app.Sms.Last["9000000001"] == "0000" ? "1111" : "0000";
        var res = await c.PostJson("api/auth/verify", new { phone = "9000000001", otp = wrong });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("Wrong code.", (string)(await res.ReadJson())["error"]!);
    }

    [Fact]
    public async Task Missing_body_is_a_400_not_a_crash()
    {
        var res = await app.Client().PostJson("api/auth/request-otp");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Too_many_sign_in_calls_are_slowed_down()
    {
        using var limited = new TestApp(s => s.AuthLimiter = new Infrastructure.RateLimiter(3));
        var c = limited.Client();
        HttpStatusCode last = 0;
        for (var i = 0; i < 4; i++) last = (await c.PostJson("api/auth/request-otp", new { phone = "9999999999" })).StatusCode;
        Assert.Equal((HttpStatusCode)429, last);
    }

    [Fact]
    public async Task Full_flow_through_the_api_with_roles()
    {
        var customer = await app.SignIn("9000000002");
        var admin = await app.SignIn("9000000000");
        var driver = await app.SignIn("9000000001");
        var me = await customer.GetJson("api/me");

        var orderId = await BookCans(customer, 3);

        // Only staff can confirm
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.PostJson($"api/orders/{orderId}/confirm")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.PostJson($"api/orders/{orderId}/confirm")).StatusCode);
        (await admin.PostJson($"api/orders/{orderId}/confirm")).EnsureSuccessStatusCode();

        var drivers = await admin.GetJson("api/drivers");
        var driverId = (int)drivers[0]!["id"]!;
        (await admin.PostJson($"api/orders/{orderId}/assign", new { driverId })).EnsureSuccessStatusCode();

        // Driver sees the order, starts it, the customer gets the delivery OTP
        var mine = await driver.GetJson("api/orders");
        Assert.Contains(mine, o => (int)o["id"]! == orderId);
        (await driver.PostJson($"api/orders/{orderId}/start")).EnsureSuccessStatusCode();
        (await driver.PostJson($"api/orders/{orderId}/location", new { lat = 13.08, lng = 80.27 })).EnsureSuccessStatusCode();
        var deliveryOtp = app.Sms.Last["9000000002"];

        // The customer sees where the driver is by polling the order
        var tracking = await customer.GetJson($"api/orders/{orderId}");
        Assert.Equal("OutForDelivery", (string)tracking["status"]!);
        Assert.Equal(13.08, (double)tracking["driverLat"]!);

        var done = await driver.PostJson($"api/orders/{orderId}/complete",
            new { otp = deliveryOtp, fullCansDelivered = 3, emptyCansCollected = 3, cashCollected = 120 });
        done.EnsureSuccessStatusCode();
        var order = await done.ReadJson();
        Assert.Equal("Completed", (string)order["status"]!);
        Assert.False(string.IsNullOrEmpty((string?)order["invoiceNo"]));

        var invoices = await customer.GetJson($"api/customers/{(int)me["customerId"]!}/invoices");
        Assert.Equal((string)order["invoiceNo"]!, (string)invoices[0]!["invoiceNo"]!);
        Assert.Equal(orderId, (int)invoices[0]!["id"]!);

        // A driver can't download a customer's invoice
        Assert.Equal(HttpStatusCode.Forbidden, (await driver.GetAsync($"api/invoices/{orderId}/pdf")).StatusCode);
    }

    /// <summary>Renders a real PDF with QuestPDF's native library (runs on Windows; Mono on Linux can't load it).</summary>
    [Fact, Trait("Needs", "QuestPdfNative")]
    public async Task Customer_downloads_invoice_pdf()
    {
        var customer = await app.SignIn("9000000002");
        var admin = await app.SignIn("9000000000");
        var driver = await app.SignIn("9000000001");
        var orderId = await BookCans(customer, 2);
        (await admin.PostJson($"api/orders/{orderId}/confirm")).EnsureSuccessStatusCode();
        var driverId = (int)(await admin.GetJson("api/drivers"))[0]!["id"]!;
        (await admin.PostJson($"api/orders/{orderId}/assign", new { driverId })).EnsureSuccessStatusCode();
        (await driver.PostJson($"api/orders/{orderId}/start")).EnsureSuccessStatusCode();
        (await driver.PostJson($"api/orders/{orderId}/complete",
            new { otp = app.Sms.Last["9000000002"], fullCansDelivered = 2, emptyCansCollected = 0, cashCollected = 0 })).EnsureSuccessStatusCode();

        var pdf = await customer.GetAsync($"api/invoices/{orderId}/pdf");
        pdf.EnsureSuccessStatusCode();
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
        var bytes = await pdf.Content.ReadAsByteArrayAsync();
        Assert.Equal("%PDF", Encoding.ASCII.GetString(bytes, 0, 4));
    }

    [Fact]
    public async Task Customer_cannot_see_someone_elses_order_or_invoices()
    {
        var admin = await app.SignIn("9000000000");
        var other = await admin.PostJson("api/customers", new
        {
            name = "Other", phone = "9111111111", type = "Shop", creditLimit = 0, addressLine = "1 Street", area = "Area"
        });
        other.EnsureSuccessStatusCode();
        var otherId = (int)(await other.ReadJson())["id"]!;

        var customer = await app.SignIn("9000000002");
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync($"api/customers/{otherId}/invoices")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("api/customers")).StatusCode);
    }

    [Fact]
    public async Task Customer_can_cancel_until_confirmed()
    {
        var customer = await app.SignIn("9000000002");
        var admin = await app.SignIn("9000000000");
        var first = await BookCans(customer, 1);
        Assert.Equal("Cancelled", (string)(await (await customer.PostJson($"api/orders/{first}/cancel")).ReadJson())["status"]!);

        var second = await BookCans(customer, 1);
        (await admin.PostJson($"api/orders/{second}/confirm")).EnsureSuccessStatusCode();
        var res = await customer.PostJson($"api/orders/{second}/cancel");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("already confirmed", (string)(await res.ReadJson())["error"]!);
    }

    /// <summary>The website (src/wbms-web/src/app/shared/models.ts) reads these exact JSON names and formats.</summary>
    [Fact]
    public async Task Json_matches_what_the_website_reads()
    {
        var customer = await app.SignIn("9000000002");
        var orderId = await BookCans(customer, 2);
        var order = (JObject)await customer.GetJson($"api/orders/{orderId}");
        foreach (var name in new[] { "id", "orderNo", "customerId", "customerName", "customerPhone", "address", "addressLat", "addressLng",
                     "status", "paymentMode", "total", "slotDate", "driverId", "driverName", "items", "driverLat", "driverLng", "invoiceNo" })
            Assert.True(order.ContainsKey(name), $"order JSON is missing {name}");
        Assert.Equal(Today, (string)order["slotDate"]!);
        Assert.Equal("Placed", (string)order["status"]!);
        Assert.Equal("Cash", (string)order["paymentMode"]!);
        var item = (JObject)order["items"]![0]!;
        foreach (var name in new[] { "productId", "product", "qty", "unitPrice" }) Assert.True(item.ContainsKey(name), name);

        var me = (JObject)await customer.GetJson("api/me");
        foreach (var name in new[] { "userId", "customerId", "name", "phone", "role", "balance", "creditLimit", "cansHeld", "addresses" })
            Assert.True(me.ContainsKey(name), $"profile JSON is missing {name}");
        Assert.Equal("Customer", (string)me["role"]!);

        var verify = await app.Client().PostJson("api/auth/request-otp", new { phone = "9000000001" });
        verify.EnsureSuccessStatusCode();
        var token = (JObject)await (await app.Client().PostJson("api/auth/verify", new { phone = "9000000001", otp = app.Sms.Last["9000000001"] })).ReadJson();
        var user = (JObject)token["user"]!;
        foreach (var name in new[] { "userId", "name", "phone", "role", "customerId", "driverId" }) Assert.True(user.ContainsKey(name), name);
        Assert.Equal("Driver", (string)user["role"]!);
    }

    [Fact]
    public async Task Admin_signs_in_with_password_and_manages_stock_staff_and_reports()
    {
        var c = app.Client();
        var bad = await c.PostJson("api/auth/password", new { phone = "9000000000", password = "nope" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var res = await c.PostJson("api/auth/password", new { phone = "9000000000", password = Data.SeedData.DemoAdminPassword });
        res.EnsureSuccessStatusCode();
        c.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", (string)(await res.ReadJson())["token"]!);

        var dash = await c.GetJson("api/admin/dashboard");
        Assert.Equal(200, (int)dash["fullStock"]!);

        var can = (await c.GetJson("api/products")).First(p => (bool)p["isReturnable"]!);
        var filled = await (await c.PostJson($"api/products/{(int)can["id"]!}/fill", new { qty = 50 })).ReadJson();
        Assert.Equal(250, (int)filled["stockFull"]!);
        var repriced = await (await c.PutJson($"api/products/{(int)can["id"]!}", new { price = 45, isActive = false })).ReadJson();
        Assert.Equal(45m, (decimal)repriced["price"]!);
        Assert.DoesNotContain(await c.GetJson("api/products"), p => (int)p["id"]! == (int)can["id"]!);
        Assert.Contains(await c.GetJson("api/products?all=true"), p => (int)p["id"]! == (int)can["id"]!);

        var staff = await (await c.PostJson("api/admin/staff", new { name = "Office", phone = "9222222222", role = "Staff", password = "office-pass-1" })).ReadJson();
        Assert.Equal("Staff", (string)staff["role"]!);
        Assert.Equal(2, (await c.GetJson("api/admin/staff")).Count());

        var report = await c.GetJson("api/admin/reports");
        Assert.Equal(0m, (decimal)report["sales"]!);

        // Staff can't manage staff logins
        var office = app.Client();
        var t = await (await office.PostJson("api/auth/password", new { phone = "9222222222", password = "office-pass-1" })).ReadJson();
        office.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", (string)t["token"]!);
        Assert.Equal(HttpStatusCode.Forbidden, (await office.GetAsync("api/admin/staff")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await office.GetAsync("api/admin/dashboard")).StatusCode);

        // Password change
        (await office.PostJson("api/me/password", new { current = "office-pass-1", @new = "office-pass-2" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await app.Client().PostJson("api/auth/password", new { phone = "9222222222", password = "office-pass-2" })).StatusCode);
    }

    [Fact]
    public async Task Orders_can_be_filtered_by_several_statuses()
    {
        var customer = await app.SignIn("9000000002");
        var admin = await app.SignIn("9000000000");
        var a = await BookCans(customer, 1);
        var b = await BookCans(customer, 1);
        (await admin.PostJson($"api/orders/{b}/confirm")).EnsureSuccessStatusCode();

        var list = await admin.GetJson("api/orders?status=Placed,Paid,OnCredit");
        Assert.Equal(new[] { a }, list.Select(o => (int)o["id"]!).ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("api/orders?status=Nope")).StatusCode);
    }

    [Fact]
    public async Task Customer_registers_on_the_website_and_adds_an_address()
    {
        var c = app.Client();
        (await c.PostJson("api/auth/register", new { name = "Meena", phone = "98765 43210", type = "Home", addressLine = "5, Lake View", area = "Adyar" }))
            .EnsureSuccessStatusCode();
        var customer = await app.SignIn("9876543210");
        var added = await customer.PostJson("api/me/addresses", new { line = "Shop 3, Bazaar St", area = "T Nagar", isDefault = true });
        added.EnsureSuccessStatusCode();
        var me = await customer.GetJson("api/me");
        Assert.Equal(2, me["addresses"]!.Count());
        Assert.Equal("Shop 3, Bazaar St", (string)me["addresses"]![0]!["line"]!); // default first
    }
}

public class WebsiteHostingTests : IDisposable
{
    private readonly string root = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "wbms-web-" + Guid.NewGuid().ToString("N"));
    private readonly TestApp app;

    public WebsiteHostingTests()
    {
        System.IO.Directory.CreateDirectory(root);
        System.IO.File.WriteAllText(System.IO.Path.Combine(root, "index.html"), "<app-root></app-root>");
        System.IO.File.WriteAllText(System.IO.Path.Combine(root, "main.js"), "console.log(1)");
        app = new TestApp(s => s.WebRoot = root);
    }

    public void Dispose()
    {
        app.Dispose();
        System.IO.Directory.Delete(root, true);
    }

    [Fact]
    public async Task Serves_the_angular_site_with_deep_links_and_leaves_the_api_alone()
    {
        var c = app.Client();
        Assert.Contains("app-root", await c.GetStringAsync(""));
        Assert.Contains("app-root", await c.GetStringAsync("orders/12")); // deep link → index.html
        Assert.Contains("console.log", await c.GetStringAsync("main.js"));
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("missing.js")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("api/orders")).StatusCode);
        Assert.Equal("ok", (string)(await c.GetJson("api"))["status"]!);
    }
}
