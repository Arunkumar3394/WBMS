using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Wbms.Core.Services;
using Wbms.Data.Services;

namespace Wbms.Tests;

public class SmsTests
{
    private class Recorder(HttpStatusCode status) : HttpMessageHandler
    {
        public HttpRequestMessage? Request;
        public string? Body;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent("{\"type\":\"error\"}") };
        }
    }

    private static readonly Msg91Options Options = new() { AuthKey = "key123", LoginTemplateId = "tpl-login", DeliveryTemplateId = "tpl-delivery" };

    [Fact]
    public async Task Delivery_code_uses_delivery_template_with_country_code_and_order()
    {
        var h = new Recorder(HttpStatusCode.OK);
        await new Msg91OtpSender(new HttpClient(h), Options, NullLogger<Msg91OtpSender>.Instance)
            .SendAsync("9000000002", "4821", OtpPurpose.Delivery, "WB123");

        Assert.Equal(Msg91OtpSender.Endpoint, h.Request!.RequestUri!.ToString());
        Assert.Equal("key123", h.Request.Headers.GetValues("authkey").Single());
        var body = JsonDocument.Parse(h.Body!).RootElement;
        Assert.Equal("tpl-delivery", body.GetProperty("template_id").GetString());
        var r = body.GetProperty("recipients")[0];
        Assert.Equal("919000000002", r.GetProperty("mobiles").GetString());
        Assert.Equal("4821", r.GetProperty("otp").GetString());
        Assert.Equal("WB123", r.GetProperty("order").GetString());
    }

    [Fact]
    public async Task Provider_error_becomes_a_friendly_message()
    {
        var sender = new Msg91OtpSender(new HttpClient(new Recorder(HttpStatusCode.Unauthorized)), Options, NullLogger<Msg91OtpSender>.Instance);
        var ex = await Assert.ThrowsAsync<WorkflowException>(() => sender.SendAsync("9000000002", "1111", OtpPurpose.Login));
        Assert.Contains("Couldn't send the SMS", ex.Message);
    }
}
