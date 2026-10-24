using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Payments
{
    /// <summary>HMAC-SHA256 signature checks, as described in Razorpay's documentation.</summary>
    public static class RazorpaySignature
    {
        /// <summary>Checkout success callback: HMAC(order_id + "|" + payment_id, key_secret).</summary>
        public static bool VerifyPayment(string razorpayOrderId, string razorpayPaymentId, string signature, string keySecret) =>
            Verify(razorpayOrderId + "|" + razorpayPaymentId, signature, keySecret);

        /// <summary>Webhook: HMAC(raw request body, webhook secret), sent in X-Razorpay-Signature.</summary>
        public static bool VerifyWebhook(string rawBody, string signature, string webhookSecret) =>
            Verify(rawBody, signature, webhookSecret);

        public static string Compute(string payload, string secret)
        {
            using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)))
            {
                var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
                var sb = new StringBuilder(hash.Length * 2);
                foreach (var b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        private static bool Verify(string payload, string signature, string secret)
        {
            if (string.IsNullOrEmpty(payload) || string.IsNullOrEmpty(signature) || string.IsNullOrEmpty(secret)) return false;
            var expected = Encoding.ASCII.GetBytes(Compute(payload, secret));
            var given = Encoding.ASCII.GetBytes(signature.Trim().ToLowerInvariant());
            return FixedTimeEquals(expected, given);
        }

        private static bool FixedTimeEquals(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            var diff = 0;
            for (var i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
    }

    public class RazorpayPayment
    {
        public string Id { get; set; }
        public string OrderId { get; set; }
        public long Amount { get; set; }
        public string Currency { get; set; }
        /// <summary>created, authorized, captured, refunded or failed.</summary>
        public string Status { get; set; }
        public string Method { get; set; }
    }

    /// <summary>The two Razorpay REST calls the site needs. The key secret never leaves the server.</summary>
    public class RazorpayClient
    {
        private readonly HttpClient _http;

        public RazorpayClient(string keyId, string keySecret, HttpMessageHandler handler = null)
        {
            _http = handler == null ? new HttpClient() : new HttpClient(handler);
            _http.BaseAddress = new Uri("https://api.razorpay.com/v1/");
            _http.Timeout = TimeSpan.FromSeconds(20);
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes(keyId + ":" + keySecret)));
        }

        /// <summary>Creates a Razorpay order. Payments are captured automatically.</summary>
        public async Task<string> CreateOrderAsync(long amountPaise, string receipt, IDictionary<string, string> notes)
        {
            var body = JsonConvert.SerializeObject(new { amount = amountPaise, currency = "INR", receipt, notes, payment_capture = 1 });
            var response = await _http.PostAsync("orders", new StringContent(body, Encoding.UTF8, "application/json"));
            var json = await ReadJson(response, "create the payment");
            return (string)json["id"];
        }

        public async Task<RazorpayPayment> FetchPaymentAsync(string paymentId)
        {
            if (string.IsNullOrEmpty(paymentId) || paymentId.Length > 40 || !paymentId.StartsWith("pay_"))
                throw new RazorpayException("Invalid payment id.");
            var response = await _http.GetAsync("payments/" + Uri.EscapeDataString(paymentId));
            var json = await ReadJson(response, "check the payment");
            return new RazorpayPayment
            {
                Id = (string)json["id"],
                OrderId = (string)json["order_id"],
                Amount = (long)json["amount"],
                Currency = (string)json["currency"],
                Status = (string)json["status"],
                Method = (string)json["method"],
            };
        }

        private static async Task<JObject> ReadJson(HttpResponseMessage response, string action)
        {
            var text = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                System.Diagnostics.Trace.TraceWarning("Razorpay could not {0}: {1} {2}", action, (int)response.StatusCode, text);
                throw new RazorpayException("The payment service could not " + action + ". Please try again.");
            }
            return JObject.Parse(text);
        }
    }

    public class RazorpayException : Exception
    {
        public RazorpayException(string message) : base(message) { }
    }
}
