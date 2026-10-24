using System;
using System.Data.Entity;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using System.Web.Http;
using Newtonsoft.Json.Linq;
using Wbms.Api47.Entities;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;

namespace Wbms.Api47.Controllers;

/// <summary>
/// Online payment: the customer asks for a Razorpay Payment Link, opens it, and Razorpay calls the webhook when the
/// money arrives, which marks the order Paid.
/// </summary>
[RoutePrefix("api")]
public class RazorpayController : WbmsController
{
    [HttpPost, Route("orders/{id:int}/payment-link"), RequireRole(Roles.Customer)]
    public async Task<IHttpActionResult> CreatePaymentLink(int id)
    {
        if (!Services.Razorpay.IsConfigured)
            return Error(HttpStatusCode.ServiceUnavailable, "Online payment is not set up yet. Please pay cash on delivery.");

        var customerId = User.RequireCustomerId();
        var order = await Db.Orders.AsNoTracking().Include(o => o.Customer.User).FirstOrDefaultAsync(o => o.Id == id && o.CustomerId == customerId);
        if (order == null) return NotFound();
        if (order.Status != OrderStatus.PaymentPending) throw new WorkflowException("This order doesn't need online payment.");

        var callback = Services.Razorpay.CallbackUrl.Replace("{orderId}", order.Id.ToString());
        var url = await new RazorpayClient(Services.Http, Services.Razorpay)
            .CreatePaymentLinkAsync(order, order.Customer.User.Name, order.Customer.User.Phone, callback);
        return Ok(new PaymentLinkResponse(url));
    }

    /// <summary>Razorpay webhook. Subscribe it to "payment_link.paid" and "payment.captured" and set Razorpay:WebhookSecret.</summary>
    [HttpPost, Route("razorpay/webhook"), AllowAnonymous]
    public async Task<IHttpActionResult> Webhook()
    {
        var options = Services.Razorpay;
        if (options.WebhookSecret == "") return Error(HttpStatusCode.ServiceUnavailable, "Razorpay is not configured.");

        var body = await Request.Content.ReadAsStringAsync();
        var given = Request.Headers.TryGetValues("X-Razorpay-Signature", out var values) ? values.FirstOrDefault() ?? "" : "";
        if (!RazorpayClient.IsValidSignature(body, given, options.WebhookSecret)) return Unauthorized();

        var doc = JObject.Parse(body);
        var evt = (string?)doc["event"];
        if (evt != "payment_link.paid" && evt != "payment.captured") return Ok();

        var payment = doc.SelectToken("payload.payment.entity") as JObject;
        if (payment == null) return Ok();
        // Payment links carry our notes on the link; direct payments carry them on the payment.
        var notesOwner = evt == "payment_link.paid" ? doc.SelectToken("payload.payment_link.entity") as JObject : payment;
        if (!TryOrderId(notesOwner, out var orderId) && !TryOrderId(payment, out orderId))
            return Ok(); // not one of ours

        var amount = (long)payment["amount"]! / 100m; // paise → rupees
        try
        {
            await Orders.RecordOnlinePaymentAsync(orderId, amount, (string)payment["id"]!);
        }
        catch (WorkflowException ex)
        {
            // Razorpay retries non-2xx responses and sends both events for a link payment, so acknowledge
            // duplicates and mismatches and leave them for staff to review.
            Console.Error.WriteLine($"[Razorpay] payment for order {orderId} not applied: {ex.Message}");
        }
        return Ok();
    }

    private static bool TryOrderId(JObject? entity, out int orderId)
    {
        orderId = 0;
        return entity?["notes"] is JObject notes && int.TryParse((string?)notes["wbms_order_id"], out orderId);
    }
}
