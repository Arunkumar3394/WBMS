using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Wbms.Api47.Infrastructure;

namespace Wbms.Api47.Services;

public enum OtpPurpose { Login, Delivery }

/// <summary>Texts a one-time code. ConsoleOtpSender prints it (development); Msg91OtpSender sends a real SMS.</summary>
public interface IOtpSender
{
    /// <param name="orderNo">The order the code is for; null for login codes.</param>
    Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null);
}

public class ConsoleOtpSender : IOtpSender
{
    public Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null)
    {
        Console.WriteLine(purpose == OtpPurpose.Login
            ? $"[OTP] {phone}: your WBMS login code is {otp}"
            : $"[OTP] {phone}: your WBMS delivery code for {orderNo} is {otp}");
        return Task.FromResult(0);
    }
}

/// <summary>
/// MSG91 settings. Indian SMS needs DLT-approved templates: create one "Flow" template per purpose in the MSG91
/// dashboard with the variables ##otp## (both) and ##order## (delivery), then put their ids in App.config.
/// </summary>
public class Msg91Options
{
    public string AuthKey { get; set; } = "";
    public string LoginTemplateId { get; set; } = "";
    public string DeliveryTemplateId { get; set; } = "";
    public string CountryCode { get; set; } = "91";
}

/// <summary>Sends codes through the MSG91 Flow API.</summary>
public class Msg91OtpSender : IOtpSender
{
    public const string Endpoint = "https://control.msg91.com/api/v5/flow";
    private readonly HttpClient http;
    private readonly Msg91Options options;

    public Msg91OtpSender(HttpClient http, Msg91Options options) { this.http = http; this.options = options; }

    public async Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null)
    {
        var templateId = purpose == OtpPurpose.Login ? options.LoginTemplateId : options.DeliveryTemplateId;
        var recipient = new Dictionary<string, string> { ["mobiles"] = options.CountryCode + phone, ["otp"] = otp };
        if (orderNo != null) recipient["order"] = orderNo;
        var body = JsonConvert.SerializeObject(new { template_id = templateId, short_url = "0", recipients = new[] { recipient } });

        using var req = new HttpRequestMessage(HttpMethod.Post, Endpoint) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add("authkey", options.AuthKey);
        try
        {
            using var res = await http.SendAsync(req);
            if (res.IsSuccessStatusCode) return;
            Console.Error.WriteLine($"[SMS] MSG91 refused SMS to {phone}: {(int)res.StatusCode} {await res.Content.ReadAsStringAsync()}");
        }
        catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException)
        {
            Console.Error.WriteLine($"[SMS] MSG91 unreachable sending SMS to {phone}: {ex.Message}");
        }
        throw new WorkflowException("Couldn't send the SMS. Please try again in a minute.");
    }
}
