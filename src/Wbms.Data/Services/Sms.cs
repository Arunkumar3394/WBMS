using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Wbms.Core.Services;

namespace Wbms.Data.Services;

/// <summary>
/// MSG91 settings. Indian SMS needs DLT-approved templates: create one "Flow" template per purpose in the MSG91
/// dashboard with the variables ##otp## (both) and ##order## (delivery), then put their ids here.
/// </summary>
public class Msg91Options
{
    public string AuthKey { get; set; } = "";
    public string LoginTemplateId { get; set; } = "";
    public string DeliveryTemplateId { get; set; } = "";
    public string CountryCode { get; set; } = "91";
}

/// <summary>Sends codes through the MSG91 Flow API.</summary>
public class Msg91OtpSender(HttpClient http, Msg91Options options, ILogger<Msg91OtpSender> logger) : IOtpSender
{
    public const string Endpoint = "https://control.msg91.com/api/v5/flow";

    public async Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null)
    {
        var templateId = purpose == OtpPurpose.Login ? options.LoginTemplateId : options.DeliveryTemplateId;
        var recipient = new Dictionary<string, string> { ["mobiles"] = options.CountryCode + phone, ["otp"] = otp };
        if (orderNo is not null) recipient["order"] = orderNo;

        using var req = new HttpRequestMessage(HttpMethod.Post, Endpoint)
        {
            Content = JsonContent.Create(new { template_id = templateId, short_url = "0", recipients = new[] { recipient } })
        };
        req.Headers.Add("authkey", options.AuthKey);

        try
        {
            using var res = await http.SendAsync(req);
            if (res.IsSuccessStatusCode) return;
            logger.LogError("MSG91 refused SMS to {Phone}: {Status} {Body}", phone, (int)res.StatusCode, await res.Content.ReadAsStringAsync());
        }
        catch (HttpRequestException ex)
        {
            logger.LogError(ex, "MSG91 unreachable sending SMS to {Phone}", phone);
        }
        throw new WorkflowException("Couldn't send the SMS. Please try again in a minute.");
    }
}

public static class SmsSetup
{
    /// <summary>Invoice PDFs with seller details from the "Business" configuration section.</summary>
    public static IServiceCollection AddWbmsInvoices(this IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton(config.GetSection("Business").Get<BusinessInfo>() ?? new BusinessInfo());
        return services.AddScoped<InvoicePdf>();
    }

    /// <summary>Uses MSG91 when Sms:Provider is "Msg91", otherwise prints codes to the console.</summary>
    public static IServiceCollection AddWbmsSms(this IServiceCollection services, IConfiguration config)
    {
        if (!string.Equals(config["Sms:Provider"], "Msg91", StringComparison.OrdinalIgnoreCase))
            return services.AddSingleton<IOtpSender, ConsoleOtpSender>();

        var options = config.GetSection("Msg91").Get<Msg91Options>() ?? new();
        if (options.AuthKey == "" || options.LoginTemplateId == "" || options.DeliveryTemplateId == "")
            throw new InvalidOperationException("Sms:Provider is Msg91 but Msg91:AuthKey, LoginTemplateId or DeliveryTemplateId is missing.");
        services.AddSingleton(options);
        services.AddHttpClient<IOtpSender, Msg91OtpSender>(c => c.Timeout = TimeSpan.FromSeconds(15));
        return services;
    }
}
