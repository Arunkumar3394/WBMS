using AquaPure.Api.Payments;
using Xunit;

namespace AquaPure.Api.Tests
{
    public class RazorpaySignatureTests
    {
        // Expected values computed independently with Node.js crypto.createHmac('sha256', secret).
        private const string PaymentSignature = "90511c59f2aa7699da2a34ba3a75734d33a8a58fb5d02eedd9bda84fe5f42f99";
        private const string WebhookBody = "{\"event\":\"payment.captured\"}";
        private const string WebhookSignature = "4f463a57dd128675850163391f0311888616d57bccca75c774c9cdb28134f851";

        [Fact]
        public void Accepts_a_correct_checkout_signature()
        {
            Assert.True(RazorpaySignature.VerifyPayment("order_ABC123", "pay_XYZ789", PaymentSignature, "test_secret_123"));
            Assert.True(RazorpaySignature.VerifyPayment("order_ABC123", "pay_XYZ789", PaymentSignature.ToUpperInvariant(), "test_secret_123"));
        }

        [Theory]
        [InlineData("order_ABC124", "pay_XYZ789", "test_secret_123")] // different order
        [InlineData("order_ABC123", "pay_XYZ780", "test_secret_123")] // different payment
        [InlineData("order_ABC123", "pay_XYZ789", "wrong_secret")]    // wrong key
        public void Rejects_a_signature_for_anything_else(string order, string payment, string secret)
        {
            Assert.False(RazorpaySignature.VerifyPayment(order, payment, PaymentSignature, secret));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("abc")]
        public void Rejects_missing_or_malformed_signatures(string signature)
        {
            Assert.False(RazorpaySignature.VerifyPayment("order_ABC123", "pay_XYZ789", signature, "test_secret_123"));
        }

        [Fact]
        public void Rejects_when_no_secret_is_configured()
        {
            Assert.False(RazorpaySignature.VerifyPayment("order_ABC123", "pay_XYZ789", PaymentSignature, ""));
            Assert.False(RazorpaySignature.VerifyWebhook(WebhookBody, WebhookSignature, null));
        }

        [Fact]
        public void Webhook_signature_covers_the_exact_body()
        {
            Assert.True(RazorpaySignature.VerifyWebhook(WebhookBody, WebhookSignature, "whsec_test"));
            Assert.False(RazorpaySignature.VerifyWebhook(WebhookBody + " ", WebhookSignature, "whsec_test"));
            Assert.False(RazorpaySignature.VerifyWebhook("{\"event\":\"payment.failed\"}", WebhookSignature, "whsec_test"));
        }
    }
}
