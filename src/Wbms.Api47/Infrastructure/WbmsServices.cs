using System;
using System.Net.Http;
using System.Web.Http;
using Wbms.Api47.Data;
using Wbms.Api47.Services;

namespace Wbms.Api47.Infrastructure;

/// <summary>Everything the controllers share, built once at startup (tests build their own with an in-memory database).</summary>
public class WbmsServices
{
    public Func<WbmsDb> CreateDb { get; set; } = () => new WbmsDb();
    public JwtOptions Jwt { get; set; } = new JwtOptions();
    public IOtpSender OtpSender { get; set; } = new ConsoleOtpSender();
    public RazorpayOptions Razorpay { get; set; } = new RazorpayOptions();
    public BusinessInfo Business { get; set; } = new BusinessInfo();
    public HttpClient Http { get; set; } = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
    public RateLimiter AuthLimiter { get; set; } = new RateLimiter(10);
    /// <summary>Folder with the built Angular site; null when there is none.</summary>
    public string? WebRoot { get; set; }

    public TokenIssuer Tokens => new TokenIssuer(Jwt);

    private const string Key = "wbms.services";
    public void AttachTo(HttpConfiguration config) => config.Properties[Key] = this;
    public static WbmsServices From(HttpConfiguration config) => (WbmsServices)config.Properties[Key];
    public static WbmsServices From(HttpRequestMessage request) => From(request.GetConfiguration());

    /// <summary>Reads App.config / environment variables. See README for every setting.</summary>
    public static WbmsServices FromConfig()
    {
        var s = new WbmsServices
        {
            Jwt = new JwtOptions
            {
                Key = AppConfig.Get("Jwt:Key"),
                Issuer = AppConfig.Get("Jwt:Issuer", "wbms"),
                Audience = AppConfig.Get("Jwt:Audience", "wbms-app"),
                Days = AppConfig.GetInt("Jwt:Days", 30),
            },
            Razorpay = new RazorpayOptions
            {
                KeyId = AppConfig.Get("Razorpay:KeyId"),
                KeySecret = AppConfig.Get("Razorpay:KeySecret"),
                WebhookSecret = AppConfig.Get("Razorpay:WebhookSecret"),
                CallbackUrl = AppConfig.Get("Razorpay:CallbackUrl"),
            },
            Business = new BusinessInfo
            {
                Name = AppConfig.Get("Business:Name", "WBMS Water Supply"),
                Address = AppConfig.Get("Business:Address"),
                Phone = AppConfig.Get("Business:Phone"),
                Gstin = AppConfig.Get("Business:Gstin"),
            },
            AuthLimiter = new RateLimiter(AppConfig.GetInt("Auth:RequestsPerMinute", 10)),
        };
        if (s.Jwt.Key.Length < 32) throw new InvalidOperationException("Set Jwt:Key (at least 32 characters) in App.config or the Jwt__Key environment variable.");

        if (string.Equals(AppConfig.Get("Sms:Provider"), "Msg91", StringComparison.OrdinalIgnoreCase))
        {
            var msg91 = new Msg91Options
            {
                AuthKey = AppConfig.Get("Msg91:AuthKey"),
                LoginTemplateId = AppConfig.Get("Msg91:LoginTemplateId"),
                DeliveryTemplateId = AppConfig.Get("Msg91:DeliveryTemplateId"),
                CountryCode = AppConfig.Get("Msg91:CountryCode", "91"),
            };
            if (msg91.AuthKey == "" || msg91.LoginTemplateId == "" || msg91.DeliveryTemplateId == "")
                throw new InvalidOperationException("Sms:Provider is Msg91 but Msg91:AuthKey, LoginTemplateId or DeliveryTemplateId is missing.");
            s.OtpSender = new Msg91OtpSender(s.Http, msg91);
        }

        if (AppConfig.GetBool("Db:InMemory", false))
        {
            // Demo mode without SQL Server: data lives in memory and is lost on restart.
            var id = Guid.NewGuid().ToString();
            s.CreateDb = () => new WbmsDb(Effort.DbConnectionFactory.CreatePersistent(id), true);
        }
        return s;
    }
}
