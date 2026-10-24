using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using System.Web.Http;
using AquaPure.Api.Auth;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Models;
using AquaPure.Api.Payments;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Controllers
{
    /// <summary>
    /// Razorpay checkout. The browser never decides that a payment succeeded: the API checks the
    /// signature, asks Razorpay for the payment, and the database records it once (app.mark_payment_captured).
    /// The webhook does the same for payments where the customer closed the page.
    /// </summary>
    [RoutePrefix("api/payments/razorpay")]
    public class PaymentsController : ApiControllerBase
    {
        private RazorpayClient Razorpay => Services.Razorpay
            ?? throw new ApiException(HttpStatusCode.ServiceUnavailable, "Online payment is not available right now. Please choose cash on delivery.");

        /// <summary>Creates (or reuses) the Razorpay order for one of the customer's orders.</summary>
        [HttpPost, Route("order"), Require(Access.User), RateLimit("payment", 30, 600)]
        public async Task<JObject> CreateOrder([FromBody] RazorpayOrderRequest r)
        {
            var razorpay = Razorpay;
            var user = CurrentUser;
            var ctx = (JObject)await Db.AsSystem(s => s.Json(
                "select app.begin_razorpay_checkout(@order, @user)::text", new { order = r.OrderId, user = user.Id }));

            var amount = (long)ctx["amount_paise"];
            var razorpayOrderId = (string)ctx["razorpay_order_id"];
            if (razorpayOrderId == null)
            {
                razorpayOrderId = await razorpay.CreateOrderAsync(amount, (string)ctx["order_no"], new Dictionary<string, string>
                {
                    ["order_id"] = r.OrderId.ToString(),
                    ["order_no"] = (string)ctx["order_no"],
                });
                await Db.AsSystem(s => s.Execute("select app.record_razorpay_order(@order, @rzp, @amount)",
                    new { order = r.OrderId, rzp = razorpayOrderId, amount }));
            }

            return new JObject
            {
                ["key_id"] = Settings.RazorpayKeyId,
                ["razorpay_order_id"] = razorpayOrderId,
                ["amount_paise"] = amount,
                ["currency"] = "INR",
                ["order_id"] = r.OrderId,
                ["order_no"] = ctx["order_no"],
                ["prefill"] = new JObject
                {
                    ["name"] = ctx["customer_name"],
                    ["email"] = ctx["customer_email"],
                    ["contact"] = ctx["customer_phone"],
                },
            };
        }

        /// <summary>Called by the site after Razorpay Checkout reports success.</summary>
        [HttpPost, Route("verify"), Require(Access.User), RateLimit("payment", 30, 600)]
        public async Task<JObject> Verify([FromBody] RazorpayVerifyRequest r)
        {
            var razorpay = Razorpay;
            if (!RazorpaySignature.VerifyPayment(r.RazorpayOrderId, r.RazorpayPaymentId, r.RazorpaySignature, Settings.RazorpayKeySecret))
                throw new ApiException(HttpStatusCode.BadRequest, "We could not verify this payment. If money was taken, it will be matched automatically or refunded.");

            var orderId = await OwnOrderFor(r.RazorpayOrderId);

            // Don't trust the browser's word: ask Razorpay what actually happened.
            var payment = await razorpay.FetchPaymentAsync(r.RazorpayPaymentId);
            if (payment.OrderId != r.RazorpayOrderId)
                throw new ApiException(HttpStatusCode.BadRequest, "This payment does not belong to this order.");

            string result;
            if (payment.Status == "captured")
                result = await Db.AsSystem(s => s.Scalar<string>("select app.mark_payment_captured(@rzp, @pay, @amount, @method)",
                    new { rzp = payment.OrderId, pay = payment.Id, amount = payment.Amount, method = payment.Method }));
            else if (payment.Status == "failed")
                result = await Db.AsSystem(s => s.Scalar<string>("select app.mark_payment_failed(@rzp, @pay, 'failed', 'Payment failed')",
                    new { rzp = payment.OrderId, pay = payment.Id }));
            else
                result = "processing"; // authorized but not yet captured: the webhook will finish it

            return new JObject { ["result"] = result, ["order_id"] = orderId };
        }

        /// <summary>Called by the site when Razorpay Checkout reports a failed attempt (customer can retry).</summary>
        [HttpPost, Route("failed"), Require(Access.User), RateLimit("payment", 30, 600)]
        public async Task<JObject> Failed([FromBody] RazorpayFailedRequest r)
        {
            var orderId = await OwnOrderFor(r.RazorpayOrderId);
            await Db.AsSystem(s => s.Execute("select app.mark_payment_failed(@rzp, @pay, @code, @description)",
                new { rzp = r.RazorpayOrderId, pay = r.RazorpayPaymentId, code = r.Code, description = r.Description }));
            return new JObject { ["order_id"] = orderId };
        }

        /// <summary>
        /// Razorpay webhook (payment.captured, order.paid, payment.failed). Configure it in the Razorpay
        /// Dashboard with the same secret as RAZORPAY_WEBHOOK_SECRET.
        /// </summary>
        [HttpPost, Route("webhook")]
        public async Task<IHttpActionResult> Webhook()
        {
            var secret = Settings.RazorpayWebhookSecret;
            if (string.IsNullOrEmpty(secret)) return StatusCode(HttpStatusCode.ServiceUnavailable);
            if (Request.Content.Headers.ContentLength > 1_000_000) return BadRequest();

            var body = await Request.Content.ReadAsStringAsync();
            var signature = Request.Headers.TryGetValues("X-Razorpay-Signature", out var sigs) ? sigs.FirstOrDefault() : null;
            if (!RazorpaySignature.VerifyWebhook(body, signature, secret)) return BadRequest();

            var json = JObject.Parse(body);
            var eventType = (string)json["event"] ?? "";
            var eventId = Request.Headers.TryGetValues("X-Razorpay-Event-Id", out var ids) ? ids.FirstOrDefault() : null;
            if (string.IsNullOrEmpty(eventId)) eventId = "sha256:" + RazorpaySignature.Compute(body, "event-id");
            var payment = json.SelectToken("payload.payment.entity") as JObject;

            // Recording the event and applying it share one transaction: if applying fails, nothing is
            // recorded, we return 500 and Razorpay sends the event again.
            await Db.AsSystem(async s =>
            {
                var isNew = await s.Scalar<bool>("select app.record_webhook_event(@id, @type, @payload::jsonb)",
                    new { id = eventId, type = eventType, payload = body });
                if (!isNew || payment == null) return 0;

                if (eventType == "payment.captured" || eventType == "order.paid")
                    await s.Execute("select app.mark_payment_captured(@rzp, @pay, @amount, @method)", new
                    {
                        rzp = (string)payment["order_id"], pay = (string)payment["id"],
                        amount = (long)payment["amount"], method = (string)payment["method"],
                    });
                else if (eventType == "payment.failed")
                    await s.Execute("select app.mark_payment_failed(@rzp, @pay, @code, @description)", new
                    {
                        rzp = (string)payment["order_id"], pay = (string)payment["id"],
                        code = (string)payment["error_code"], description = (string)payment["error_description"],
                    });
                return 0;
            });
            return Ok();
        }

        /// <summary>The AquaPure order behind a Razorpay order, if it belongs to the signed-in user (RLS).</summary>
        private async Task<Guid> OwnOrderFor(string razorpayOrderId)
        {
            var id = await Db.AsUser(CurrentUser, s => s.Scalar<Guid?>(
                "select order_id from app.payments where razorpay_order_id = @rzp", new { rzp = razorpayOrderId }));
            return id ?? throw new ApiException(HttpStatusCode.NotFound, "Payment not found.");
        }
    }
}
