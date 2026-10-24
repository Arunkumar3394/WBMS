using System;
using System.Configuration;
using System.Linq;

namespace AquaPure.Api.Infrastructure
{
    /// <summary>Configuration: environment variables first, then App.config / secrets.config.</summary>
    public class Settings
    {
        public string ApiUrl { get; set; }
        public string[] AllowedOrigins { get; set; }
        public bool TrustProxy { get; set; }
        public string SupabaseUrl { get; set; }
        /// <summary>Optional: the address browsers use for Supabase, e.g. a proxy on your own domain (see SETUP.md). Defaults to SupabaseUrl.</summary>
        public string SupabasePublicUrl { get; set; }
        public string SupabaseJwtSecret { get; set; }
        public string DbConnection { get; set; }
        public string RazorpayKeyId { get; set; }
        public string RazorpayKeySecret { get; set; }
        public string RazorpayWebhookSecret { get; set; }

        public bool RazorpayConfigured => !string.IsNullOrEmpty(RazorpayKeyId) && !string.IsNullOrEmpty(RazorpayKeySecret);

        /// <summary>Public URL of an image in the product-images bucket (or the path itself if it is already a URL).</summary>
        public string ImageUrl(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            if (path.StartsWith("http://") || path.StartsWith("https://") || path.StartsWith("/")) return path;
            return (string.IsNullOrEmpty(SupabasePublicUrl) ? SupabaseUrl : SupabasePublicUrl).TrimEnd('/') + "/storage/v1/object/public/product-images/" + Uri.EscapeUriString(path);
        }

        public static Settings Load()
        {
            var port = Environment.GetEnvironmentVariable("HTTP_PLATFORM_PORT"); // set by IIS HttpPlatformHandler
            var s = new Settings
            {
                ApiUrl = port != null ? "http://127.0.0.1:" + port + "/" : Get("API_URL", "http://localhost:5080/"),
                AllowedOrigins = Get("ALLOWED_ORIGINS", "")
                    .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(o => o.Trim().TrimEnd('/')).Where(o => o.Length > 0).ToArray(),
                TrustProxy = port != null || string.Equals(Get("TRUST_PROXY", "false"), "true", StringComparison.OrdinalIgnoreCase),
                SupabaseUrl = Get("SUPABASE_URL", "").TrimEnd('/'),
                SupabasePublicUrl = Get("SUPABASE_PUBLIC_URL", "").TrimEnd('/'),
                SupabaseJwtSecret = Get("SUPABASE_JWT_SECRET", ""),
                DbConnection = Get("DB_CONNECTION", ""),
                RazorpayKeyId = Get("RAZORPAY_KEY_ID", ""),
                RazorpayKeySecret = Get("RAZORPAY_KEY_SECRET", ""),
                RazorpayWebhookSecret = Get("RAZORPAY_WEBHOOK_SECRET", ""),
            };

            if (string.IsNullOrEmpty(s.SupabaseUrl) || !s.SupabaseUrl.StartsWith("https://"))
                throw new ConfigurationErrorsException("Set SUPABASE_URL (https://YOUR-PROJECT-REF.supabase.co). See SETUP.md.");
            if (string.IsNullOrEmpty(s.DbConnection))
                throw new ConfigurationErrorsException("Set DB_CONNECTION (the wbms_api connection string). See SETUP.md.");
            if (s.RazorpayKeyId.StartsWith("rzp_live_") && string.IsNullOrEmpty(s.RazorpayWebhookSecret))
                throw new ConfigurationErrorsException("Live Razorpay keys need RAZORPAY_WEBHOOK_SECRET as well.");
            return s;
        }

        private static string Get(string key, string fallback)
        {
            var env = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
            var cfg = ConfigurationManager.AppSettings[key];
            return string.IsNullOrWhiteSpace(cfg) ? fallback : cfg.Trim();
        }
    }
}
