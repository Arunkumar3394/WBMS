using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using AquaPure.Api.Payments;
using Newtonsoft.Json.Linq;
using Xunit;
using static AquaPure.Api.Tests.Integration.ApiFixture;

namespace AquaPure.Api.Tests.Integration
{
    /// <summary>HTTP → API → real SQL with RLS. Tests share one database, so each creates its own orders.</summary>
    [Collection("api")]
    public class ApiTests
    {
        private readonly ApiFixture _f;
        public ApiTests(ApiFixture fixture) { _f = fixture; }

        // ---------- Helpers ----------
        private async Task<string> Tomorrow()
        {
            var (_, s) = await _f.Client().Get("/api/settings");
            return DateTime.Parse((string)s["today"]).AddDays(1).ToString("yyyy-MM-dd");
        }

        private async Task<int> ProductId(string slug)
        {
            var (_, p) = await _f.Client().Get("/api/catalog/products/" + slug);
            return (int)p["id"];
        }

        private async Task<int> MorningSlot(string date)
        {
            var (_, slots) = await _f.Client().Get("/api/delivery/slots?date=" + date);
            return (int)slots.First(s => (string)s["label"] == "Morning")["slot_id"];
        }

        private async Task<string> AddressFor(Guid user, string pincode = "600001")
        {
            var (status, a) = await _f.Client(user).Post("/api/me/addresses", new
            {
                label = "Home", contact_name = "Test", contact_phone = "9876543210",
                line1 = "12 Test Street", city = "Chennai", pincode,
            });
            Assert.Equal(HttpStatusCode.OK, status);
            return (string)a["id"];
        }

        private async Task<JToken> PlaceOrder(Guid user, string method = "cod", int qty = 2, Guid? key = null)
        {
            var date = await Tomorrow();
            var (status, body) = await _f.Client(user).Post("/api/orders", new
            {
                address_id = await AddressFor(user),
                items = new[] { new { product_id = await ProductId("20-litre-water-can"), quantity = qty } },
                delivery_date = date,
                slot_id = await MorningSlot(date),
                payment_method = method,
                idempotency_key = key ?? Guid.NewGuid(),
            });
            Assert.True(status == HttpStatusCode.OK, "Place order failed: " + body);
            return body;
        }

        // ---------- Public ----------
        [Fact]
        public async Task Public_pages_work_without_signing_in()
        {
            var c = _f.Client();
            Assert.Equal("ok", (string)(await c.Get("/api/health")).Body["status"]);

            var (status, catalog) = await c.Get("/api/catalog");
            Assert.Equal(HttpStatusCode.OK, status);
            Assert.Equal(2, catalog["categories"].Count());
            Assert.True(catalog["products"].Count() >= 5);
            Assert.All(catalog["products"], p => Assert.NotNull(p["is_sample_price"]));
            Assert.Null(catalog["products"][0]["stock_qty"]); // exact stock is not public

            var (_, settings) = await c.Get("/api/settings");
            Assert.True((bool)settings["online_payment_enabled"]);
            Assert.Equal("rzp_test_key", (string)settings["razorpay_key_id"]);

            Assert.True((bool)(await c.Get("/api/delivery/check?pincode=600001")).Body["served"]);
            Assert.False((bool)(await c.Get("/api/delivery/check?pincode=110001")).Body["served"]);
            Assert.Equal(HttpStatusCode.BadRequest, (await c.Get("/api/delivery/check?pincode=12")).Status);
            Assert.Equal(HttpStatusCode.NotFound, (await c.Get("/api/catalog/products/no-such-thing")).Status);
            Assert.True((await c.Get("/api/testimonials")).Body.All(t => (bool)t["is_sample"]));
        }

        [Fact]
        public async Task Signed_in_areas_need_a_valid_token()
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await _f.Client().Get("/api/me")).Status);

            var expired = _f.Client();
            expired.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _f.Token(Customer, DateTime.UtcNow.AddMinutes(-10)));
            var (status, body) = await expired.Get("/api/me");
            Assert.Equal(HttpStatusCode.Unauthorized, status);
            Assert.Contains("sign in", (string)body["error"]);

            Assert.Equal(HttpStatusCode.OK, (await _f.Client(Customer).Get("/api/me")).Status);
        }

        [Fact]
        public async Task Customers_cannot_use_staff_or_admin_endpoints()
        {
            var c = _f.Client(Customer);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.Get("/api/admin/orders")).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.Get("/api/admin/dashboard")).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.Get("/api/admin/products")).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await c.Put("/api/admin/settings", new { deposit_enabled = true, cod_enabled = true, online_payment_enabled = true, max_advance_days = 7, unpaid_order_expiry_minutes = 30 })).Status);
            // Staff can see orders but not change prices or settings.
            Assert.Equal(HttpStatusCode.OK, (await _f.Client(Staff).Get("/api/admin/orders")).Status);
            Assert.Equal(HttpStatusCode.Forbidden, (await _f.Client(Staff).Get("/api/admin/products")).Status);
        }

        // ---------- Account ----------
        [Fact]
        public async Task Profile_and_address_validation()
        {
            var c = _f.Client(Customer);
            var (status, me) = await c.Put("/api/me", new { full_name = "Asha", phone = "9876543210", customer_type = "office" });
            Assert.Equal(HttpStatusCode.OK, status);
            Assert.Equal("office", (string)me["customer_type"]);
            Assert.Equal("customer", (string)me["role"]);

            // Sending "role" is simply ignored.
            await c.Put("/api/me", new { full_name = "Asha", role = "admin" });
            Assert.Equal("customer", (string)(await c.Get("/api/me")).Body["role"]);

            var (bad, err) = await c.Post("/api/me/addresses", new { contact_name = "A", contact_phone = "98765", line1 = "Somewhere", city = "Chennai", pincode = "60001" });
            Assert.Equal(HttpStatusCode.BadRequest, bad);
            Assert.False(string.IsNullOrEmpty((string)err["error"]));

            var (missing, _) = await c.Send(HttpMethod.Post, "/api/me/addresses", "");
            Assert.Equal(HttpStatusCode.BadRequest, missing);

            var id = await AddressFor(Customer);
            var (_, list) = await c.Get("/api/me/addresses");
            Assert.Contains(list, a => (string)a["id"] == id);
            // Another customer cannot touch it.
            Assert.Equal(HttpStatusCode.NotFound, (await _f.Client(OtherCustomer).Post("/api/me/addresses/" + id + "/default")).Status);
        }

        // ---------- Orders ----------
        [Fact]
        public async Task Orders_are_priced_by_the_server_and_not_duplicated()
        {
            var key = Guid.NewGuid();
            var first = await PlaceOrder(Customer, qty: 3, key: key);
            Assert.Equal(120m, (decimal)first["subtotal"]);   // 3 × sample ₹40, ignoring anything the browser says
            Assert.Equal((decimal)first["subtotal"] + (decimal)first["delivery_charge"] + (decimal)first["deposit_total"], (decimal)first["total"]);
            Assert.Equal("pending", (string)first["status"]);
            Assert.Null(first["admin_notes"]);           // staff-only fields are hidden from customers
            Assert.Single(first["history"]);

            var again = await PlaceOrder(Customer, qty: 3, key: key);
            Assert.Equal((string)first["id"], (string)again["id"]);

            Assert.Equal(HttpStatusCode.NotFound, (await _f.Client(OtherCustomer).Get("/api/orders/" + first["id"])).Status);
            var (_, mine) = await _f.Client(Customer).Get("/api/orders");
            Assert.Contains(mine, o => (string)o["id"] == (string)first["id"]);
        }

        [Fact]
        public async Task Business_rule_errors_come_back_as_readable_400s()
        {
            var date = await Tomorrow();
            var (status, body) = await _f.Client(Customer).Post("/api/orders", new
            {
                address_id = await AddressFor(Customer, "110001"),
                items = new[] { new { product_id = await ProductId("20-litre-water-can"), quantity = 1 } },
                delivery_date = date, slot_id = await MorningSlot(date), payment_method = "cod", idempotency_key = Guid.NewGuid(),
            });
            Assert.Equal(HttpStatusCode.BadRequest, status);
            Assert.Contains("do not deliver to pincode 110001", (string)body["error"]);

            var (s2, b2) = await _f.Client(Customer).Post("/api/orders/quote", new { address_id = Guid.NewGuid(), items = new object[0] });
            Assert.Equal(HttpStatusCode.BadRequest, s2);
            Assert.Equal("Your cart is empty.", (string)b2["error"]);
        }

        [Fact]
        public async Task Order_lifecycle_through_staff_actions()
        {
            var order = await PlaceOrder(Customer);
            var id = (string)order["id"];
            var staff = _f.Client(Staff);

            Assert.Equal(HttpStatusCode.BadRequest, (await staff.Post($"/api/admin/orders/{id}/status", new { status = "delivered" })).Status);
            Assert.Equal("confirmed", (string)(await staff.Post($"/api/admin/orders/{id}/status", new { status = "confirmed" })).Body["status"]);
            Assert.Equal(HttpStatusCode.BadRequest, (await _f.Client(Customer).Post($"/api/orders/{id}/cancel", new { reason = "x" })).Status);
            await staff.Post($"/api/admin/orders/{id}/status", new { status = "out_for_delivery" });
            var (_, delivered) = await staff.Post($"/api/admin/orders/{id}/status", new { status = "delivered", cans_delivered = 2, empties_collected = 2 });
            Assert.Equal("delivered", (string)delivered["status"]);
            Assert.NotNull(delivered["customer"]);
            var (_, paid) = await staff.Post($"/api/admin/orders/{id}/cod-paid");
            Assert.Equal("paid", (string)paid["payment_status"]);
            // Only admins record refunds.
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.Post($"/api/admin/orders/{id}/refunded", new { note = "x" })).Status);
        }

        [Fact]
        public async Task Admin_price_changes_reach_the_catalog()
        {
            var admin = _f.Client(Admin);
            var (_, products) = await admin.Get("/api/admin/products");
            var p = (JObject)products.First(x => (string)x["slug"] == "bottle-2l-case-9");
            p["price"] = 175.50m;
            p["is_sample_price"] = false;
            var (status, updated) = await admin.Put("/api/admin/products/" + p["id"], p);
            Assert.Equal(HttpStatusCode.OK, status);
            Assert.Equal(175.50m, (decimal)updated["price"]);
            var (_, pub) = await _f.Client().Get("/api/catalog/products/bottle-2l-case-9");
            Assert.Equal(175.50m, (decimal)pub["price"]);
            Assert.False((bool)pub["is_sample_price"]);

            var (s2, stock) = await admin.Post($"/api/admin/products/{p["id"]}/stock", new { delta = 10, reason = "restock", note = "Test" });
            Assert.Equal(HttpStatusCode.OK, s2);
            Assert.True((int)stock["stock_qty"] > 10);
        }

        // ---------- Razorpay ----------
        private async Task<(string OrderId, string RzpOrderId, long Amount)> StartOnlinePayment(Guid user)
        {
            var order = await PlaceOrder(user, method: "razorpay");
            Assert.Equal("pending", (string)order["payment_status"]);
            var (status, rzp) = await _f.Client(user).Post("/api/payments/razorpay/order", new { order_id = order["id"] });
            Assert.True(status == HttpStatusCode.OK, rzp?.ToString());
            Assert.Equal((long)((decimal)order["total"] * 100), (long)rzp["amount_paise"]);
            Assert.Equal("rzp_test_key", (string)rzp["key_id"]);
            return ((string)order["id"], (string)rzp["razorpay_order_id"], (long)rzp["amount_paise"]);
        }

        private Task<(HttpStatusCode Status, JToken Body)> Verify(Guid user, string rzpOrder, string payment, string signature = null) =>
            _f.Client(user).Post("/api/payments/razorpay/verify", new
            {
                razorpay_order_id = rzpOrder,
                razorpay_payment_id = payment,
                razorpay_signature = signature ?? RazorpaySignature.Compute(rzpOrder + "|" + payment, RazorpayKeySecret),
            });

        [Fact]
        public async Task Successful_payment_is_verified_with_razorpay_and_recorded_once()
        {
            var (orderId, rzpOrder, amount) = await StartOnlinePayment(Customer);

            // A retry reuses the same Razorpay order.
            var created = _f.Razorpay.CreatedOrderAmounts.Count;
            var (_, again) = await _f.Client(Customer).Post("/api/payments/razorpay/order", new { order_id = orderId });
            Assert.Equal(rzpOrder, (string)again["razorpay_order_id"]);
            Assert.Equal(created, _f.Razorpay.CreatedOrderAmounts.Count);

            var paymentId = "pay_" + Guid.NewGuid().ToString("N").Substring(0, 14);
            _f.Razorpay.AddPayment(paymentId, rzpOrder, amount);

            // A forged signature changes nothing.
            Assert.Equal(HttpStatusCode.BadRequest, (await Verify(Customer, rzpOrder, paymentId, new string('a', 64))).Status);
            Assert.Equal("pending", (string)(await _f.Client(Customer).Get("/api/orders/" + orderId)).Body["payment_status"]);

            var (status, result) = await Verify(Customer, rzpOrder, paymentId);
            Assert.Equal(HttpStatusCode.OK, status);
            Assert.Equal("applied", (string)result["result"]);
            Assert.Equal("already_recorded", (string)(await Verify(Customer, rzpOrder, paymentId)).Body["result"]);

            var (_, order) = await _f.Client(Customer).Get("/api/orders/" + orderId);
            Assert.Equal("paid", (string)order["payment_status"]);
            Assert.Single(order["payments"]);
            Assert.Equal(HttpStatusCode.BadRequest, (await _f.Client(Customer).Post("/api/payments/razorpay/order", new { order_id = orderId })).Status);
        }

        [Fact]
        public async Task Payment_that_razorpay_reports_differently_is_not_trusted()
        {
            var (orderId, rzpOrder, amount) = await StartOnlinePayment(Customer);
            var paymentId = "pay_" + Guid.NewGuid().ToString("N").Substring(0, 14);
            _f.Razorpay.AddPayment(paymentId, rzpOrder, amount - 100); // less than the order total
            Assert.Equal("amount_mismatch", (string)(await Verify(Customer, rzpOrder, paymentId)).Body["result"]);
            Assert.Equal("pending", (string)(await _f.Client(Customer).Get("/api/orders/" + orderId)).Body["payment_status"]);

            var failedId = "pay_" + Guid.NewGuid().ToString("N").Substring(0, 14);
            _f.Razorpay.AddPayment(failedId, rzpOrder, amount, "failed");
            Assert.Equal("recorded", (string)(await Verify(Customer, rzpOrder, failedId)).Body["result"]);
        }

        [Fact]
        public async Task Another_customer_cannot_verify_or_pay_for_my_order()
        {
            var (orderId, rzpOrder, amount) = await StartOnlinePayment(Customer);
            Assert.Equal(HttpStatusCode.NotFound, (await _f.Client(OtherCustomer).Post("/api/payments/razorpay/order", new { order_id = orderId })).Status);
            var paymentId = "pay_" + Guid.NewGuid().ToString("N").Substring(0, 14);
            _f.Razorpay.AddPayment(paymentId, rzpOrder, amount);
            Assert.Equal(HttpStatusCode.NotFound, (await Verify(OtherCustomer, rzpOrder, paymentId)).Status);
        }

        [Fact]
        public async Task Webhook_marks_paid_once_and_rejects_bad_signatures()
        {
            var (orderId, rzpOrder, amount) = await StartOnlinePayment(OtherCustomer);
            var paymentId = "pay_" + Guid.NewGuid().ToString("N").Substring(0, 14);
            var body = new JObject
            {
                ["event"] = "payment.captured",
                ["payload"] = new JObject { ["payment"] = new JObject { ["entity"] = new JObject
                {
                    ["id"] = paymentId, ["order_id"] = rzpOrder, ["amount"] = amount, ["method"] = "upi", ["status"] = "captured",
                } } },
            }.ToString(Newtonsoft.Json.Formatting.None);

            async Task<HttpStatusCode> Send(string signature, string eventId)
            {
                var request = new HttpRequestMessage(HttpMethod.Post, "/api/payments/razorpay/webhook")
                {
                    Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json"),
                };
                request.Headers.Add("X-Razorpay-Signature", signature);
                request.Headers.Add("X-Razorpay-Event-Id", eventId);
                return (await _f.Client().SendAsync(request)).StatusCode;
            }

            Assert.Equal(HttpStatusCode.BadRequest, await Send(RazorpaySignature.Compute(body, "wrong-secret"), "evt_bad"));
            Assert.Equal("pending", (string)(await _f.Client(OtherCustomer).Get("/api/orders/" + orderId)).Body["payment_status"]);

            var good = RazorpaySignature.Compute(body, WebhookSecret);
            var eventId = "evt_" + Guid.NewGuid().ToString("N");
            Assert.Equal(HttpStatusCode.OK, await Send(good, eventId));
            Assert.Equal(HttpStatusCode.OK, await Send(good, eventId)); // replay
            var (_, order) = await _f.Client(OtherCustomer).Get("/api/orders/" + orderId);
            Assert.Equal("paid", (string)order["payment_status"]);
            Assert.Single(order["payments"]);
        }

        // ---------- Enquiries ----------
        [Fact]
        public async Task Enquiries_are_stored_spam_is_dropped_and_floods_are_limited()
        {
            var c = _f.Client();
            var (s1, ok) = await c.Post("/api/enquiries", new { enquiry_type = "bulk_order", name = "Ravi", phone = "98765 43210", message = "Need 200 cases for a wedding" });
            Assert.Equal(HttpStatusCode.OK, s1);
            Assert.NotNull(ok["id"]);
            var (_, spam) = await c.Post("/api/enquiries", new { name = "Bot", phone = "9876543210", message = "Buy now!!!", website = "http://spam" });
            Assert.Null(spam["id"]);

            var (_, list) = await _f.Client(Staff).Get("/api/admin/enquiries");
            Assert.Contains(list, e => (string)e["name"] == "Ravi");
            Assert.DoesNotContain(list, e => (string)e["name"] == "Bot");

            HttpStatusCode last = HttpStatusCode.OK;
            for (var i = 0; i < 6; i++)
                last = (await c.Post("/api/enquiries", new { name = "Flood", phone = "9876543210", message = "Hello there " + i })).Status;
            Assert.Equal((HttpStatusCode)429, last);
        }

        [Fact]
        public async Task Reports_add_up_for_admins()
        {
            await PlaceOrder(Customer);
            var (_, s) = await _f.Client().Get("/api/settings");
            var today = (string)s["today"];
            var (status, report) = await _f.Client(Admin).Get($"/api/admin/reports/sales?from={today}&to={today}");
            Assert.Equal(HttpStatusCode.OK, status);
            Assert.True((int)report["totals"]["orders"] >= 1);
            Assert.Equal(HttpStatusCode.Forbidden, (await _f.Client(Customer).Get($"/api/admin/reports/sales?from={today}&to={today}")).Status);
        }
    }
}
