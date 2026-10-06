using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Wbms.Data.Services;

namespace Wbms.Api.Controllers;

/// <summary>
/// Razorpay webhook for "payment.captured". When creating the Razorpay order/payment link from the app,
/// put our order id in notes as "wbms_order_id". Set Razorpay:WebhookSecret in configuration.
/// </summary>
[ApiController]
[Route("api/razorpay")]
public class RazorpayController(OrderService orders, IConfiguration config, ILogger<RazorpayController> logger) : ControllerBase
{
    [HttpPost("webhook")]
    public async Task<IActionResult> Webhook()
    {
        var secret = config["Razorpay:WebhookSecret"];
        if (string.IsNullOrEmpty(secret)) return StatusCode(503, new { error = "Razorpay is not configured." });

        using var reader = new StreamReader(Request.Body);
        var body = await reader.ReadToEndAsync();
        var expected = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        var given = Request.Headers["X-Razorpay-Signature"].ToString();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(given)))
            return Unauthorized();

        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.GetProperty("event").GetString() != "payment.captured") return Ok();

        var payment = doc.RootElement.GetProperty("payload").GetProperty("payment").GetProperty("entity");
        if (!payment.TryGetProperty("notes", out var notes) || notes.ValueKind != JsonValueKind.Object ||
            !notes.TryGetProperty("wbms_order_id", out var idProp) || !int.TryParse(idProp.ToString(), out var orderId))
            return Ok(); // not one of ours

        var amount = payment.GetProperty("amount").GetInt64() / 100m; // paise → rupees
        try
        {
            await orders.RecordOnlinePaymentAsync(orderId, amount, payment.GetProperty("id").GetString()!);
        }
        catch (Wbms.Core.Services.WorkflowException ex)
        {
            // Razorpay retries non-2xx responses, so acknowledge duplicates and mismatches and leave them for staff to review.
            logger.LogWarning("Razorpay payment for order {OrderId} not applied: {Reason}", orderId, ex.Message);
        }
        return Ok();
    }
}
