using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Wbms.Api47.Entities;
using Wbms.Api47.Infrastructure;

namespace Wbms.Api47.Services;

public class RazorpayOptions
{
    public string KeyId { get; set; } = "";
    public string KeySecret { get; set; } = "";
    public string WebhookSecret { get; set; } = "";
    /// <summary>Optional page Razorpay sends the customer back to after paying, e.g. https://yoursite/orders.</summary>
    public string CallbackUrl { get; set; } = "";
    public bool IsConfigured => KeyId != "" && KeySecret != "";
}

/// <summary>Razorpay Payment Links and webhook signature checks. Our order id travels in notes.wbms_order_id.</summary>
public class RazorpayClient
{
    public const string PaymentLinksEndpoint = "https://api.razorpay.com/v1/payment_links";
    private readonly HttpClient http;
    private readonly RazorpayOptions options;

    public RazorpayClient(HttpClient http, RazorpayOptions options) { this.http = http; this.options = options; }

    /// <summary>Creates a payment link for the order and returns its short URL.</summary>
    public async Task<string> CreatePaymentLinkAsync(Order order, string customerName, string customerPhone, string? callbackUrl)
    {
        var body = new JObject
        {
            ["amount"] = (long)(order.Total * 100), // paise
            ["currency"] = "INR",
            ["description"] = $"Water order {order.OrderNo}",
            ["customer"] = new JObject { ["name"] = customerName, ["contact"] = "+91" + customerPhone },
            ["notify"] = new JObject { ["sms"] = false, ["email"] = false },
            ["reminder_enable"] = false,
            ["notes"] = new JObject { ["wbms_order_id"] = order.Id.ToString() },
        };
        var callback = string.IsNullOrEmpty(callbackUrl) ? options.CallbackUrl : callbackUrl;
        if (!string.IsNullOrEmpty(callback))
        {
            body["callback_url"] = callback;
            body["callback_method"] = "get";
        }

        using var req = new HttpRequestMessage(HttpMethod.Post, PaymentLinksEndpoint)
        {
            Content = new StringContent(body.ToString(Formatting.None), Encoding.UTF8, "application/json")
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{options.KeyId}:{options.KeySecret}")));

        using var res = await http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            Console.Error.WriteLine($"[Razorpay] payment link failed for order {order.Id}: {(int)res.StatusCode} {text}");
            throw new WorkflowException("Couldn't start online payment. Please try again or pay cash.");
        }
        return (string)JObject.Parse(text)["short_url"]!;
    }

    /// <summary>True when X-Razorpay-Signature is the HMAC-SHA256 (hex) of the raw body with the webhook secret.</summary>
    public static bool IsValidSignature(string body, string signature, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = BitConverter.ToString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).Replace("-", "").ToLowerInvariant();
        return Otp.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(signature ?? ""));
    }
}
