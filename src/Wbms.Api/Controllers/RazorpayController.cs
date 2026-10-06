using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Wbms.Api.Auth;
using Wbms.Core.Entities;
using Wbms.Core.Services;
using Wbms.Data;
using Wbms.Data.Services;

namespace Wbms.Api.Controllers;

public class RazorpayOptions
{
    public string KeyId { get; set; } = "";
    public string KeySecret { get; set; } = "";
    public string WebhookSecret { get; set; } = "";
    public bool IsConfigured => KeyId != "" && KeySecret != "";
}

public record PaymentLinkResponse(string Url);

/// <summary>
/// Online payment: the customer app asks for a Razorpay Payment Link, opens it in the browser, and Razorpay
/// calls the webhook when the money arrives, which marks the order Paid. Our order id travels in notes.wbms_order_id.
/// </summary>
[ApiController]
[Route("api")]
public class RazorpayController(OrderService orders, WbmsDbContext db, RazorpayOptions options, IHttpClientFactory httpFactory,
    ILogger<RazorpayController> logger) : ControllerBase
{
    public const string PaymentLinksEndpoint = "https://api.razorpay.com/v1/payment_links";

    [HttpPost("orders/{id:int}/payment-link")]
    [Authorize(Roles = Roles.Customer)]
    public async Task<ActionResult<PaymentLinkResponse>> CreatePaymentLink(int id)
    {
        if (!options.IsConfigured) return StatusCode(503, new { error = "Online payment is not set up yet. Please pay cash on delivery." });

        var order = await db.Orders.AsNoTracking().Include(o => o.Customer).ThenInclude(c => c.User)
            .FirstOrDefaultAsync(o => o.Id == id && o.CustomerId == User.RequireCustomerId());
        if (order is null) return NotFound();
        if (order.Status != OrderStatus.PaymentPending) return BadRequest(new { error = "This order doesn't need online payment." });

        using var req = new HttpRequestMessage(HttpMethod.Post, PaymentLinksEndpoint)
        {
            Content = JsonContent.Create(new
            {
                amount = (long)(order.Total * 100), // paise
                currency = "INR",
                description = $"Water order {order.OrderNo}",
                customer = new { name = order.Customer.User.Name, contact = "+91" + order.Customer.User.Phone },
                notify = new { sms = false, email = false },
                reminder_enable = false,
                notes = new { wbms_order_id = order.Id.ToString() }
            })
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.KeyId}:{options.KeySecret}")));

        using var res = await httpFactory.CreateClient("razorpay").SendAsync(req);
        if (!res.IsSuccessStatusCode)
        {
            logger.LogError("Razorpay payment link failed for order {OrderId}: {Status} {Body}", id, (int)res.StatusCode, await res.Content.ReadAsStringAsync());
            return StatusCode(502, new { error = "Couldn't start online payment. Please try again or pay cash." });
        }
        var link = await res.Content.ReadFromJsonAsync<JsonElement>();
        return new PaymentLinkResponse(link.GetProperty("short_url").GetString()!);
    }

    /// <summary>Razorpay webhook. Subscribe it to "payment_link.paid" and "payment.captured" and set Razorpay:WebhookSecret.</summary>
    [HttpPost("razorpay/webhook")]
    [AllowAnonymous]
    public async Task<IActionResult> Webhook()
    {
        if (options.WebhookSecret == "") return StatusCode(503, new { error = "Razorpay is not configured." });

        using var reader = new StreamReader(Request.Body);
        var body = await reader.ReadToEndAsync();
        var expected = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(options.WebhookSecret), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        var given = Request.Headers["X-Razorpay-Signature"].ToString();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(given)))
            return Unauthorized();

        using var doc = JsonDocument.Parse(body);
        var evt = doc.RootElement.GetProperty("event").GetString();
        var payload = doc.RootElement.GetProperty("payload");
        if (evt is not ("payment_link.paid" or "payment.captured")) return Ok();

        var payment = payload.GetProperty("payment").GetProperty("entity");
        // Payment links carry our notes on the link; direct payments carry them on the payment.
        var notesOwner = evt == "payment_link.paid" ? payload.GetProperty("payment_link").GetProperty("entity") : payment;
        if (!TryOrderId(notesOwner, out var orderId) && !TryOrderId(payment, out orderId))
            return Ok(); // not one of ours

        var amount = payment.GetProperty("amount").GetInt64() / 100m; // paise → rupees
        try
        {
            await orders.RecordOnlinePaymentAsync(orderId, amount, payment.GetProperty("id").GetString()!);
        }
        catch (WorkflowException ex)
        {
            // Razorpay retries non-2xx responses and sends both events for a link payment, so acknowledge
            // duplicates and mismatches and leave them for staff to review.
            logger.LogWarning("Razorpay payment for order {OrderId} not applied: {Reason}", orderId, ex.Message);
        }
        return Ok();
    }

    private static bool TryOrderId(JsonElement entity, out int orderId)
    {
        orderId = 0;
        return entity.TryGetProperty("notes", out var notes) && notes.ValueKind == JsonValueKind.Object &&
               notes.TryGetProperty("wbms_order_id", out var idProp) && int.TryParse(idProp.ToString(), out orderId);
    }
}
