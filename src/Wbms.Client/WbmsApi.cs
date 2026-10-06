using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Wbms.Client;

public class ApiException(string message, HttpStatusCode status) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
}

/// <summary>Typed client for the WBMS API. Error messages from the server are passed through for display.</summary>
public class WbmsApi(HttpClient http)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public Uri BaseAddress => http.BaseAddress!;
    public string? Token { get; private set; }

    public void UseToken(string? token)
    {
        Token = token;
        http.DefaultRequestHeaders.Authorization = token is null ? null : new AuthenticationHeaderValue("Bearer", token);
    }

    // Sign-in
    public Task RegisterAsync(RegisterRequest r) => Send(HttpMethod.Post, "api/auth/register", r);
    public Task RequestOtpAsync(string phone) => Send(HttpMethod.Post, "api/auth/request-otp", new { phone });
    public Task<TokenResponse> VerifyAsync(string phone, string otp) => Send<TokenResponse>(HttpMethod.Post, "api/auth/verify", new { phone, otp });

    // Shared
    public Task<Profile> MeAsync() => Send<Profile>(HttpMethod.Get, "api/me");
    public Task<List<Order>> OrdersAsync(OrderStatus? status = null) =>
        Send<List<Order>>(HttpMethod.Get, status is null ? "api/orders" : $"api/orders?status={status}");
    public Task<Order> OrderAsync(int id) => Send<Order>(HttpMethod.Get, $"api/orders/{id}");

    // Customer
    public Task<List<Product>> ProductsAsync() => Send<List<Product>>(HttpMethod.Get, "api/products");
    public Task<Order> BookAsync(BookRequest r) => Send<Order>(HttpMethod.Post, "api/orders", r);
    public Task<Order> CancelAsync(int id) => Send<Order>(HttpMethod.Post, $"api/orders/{id}/cancel");
    public Task<List<Invoice>> InvoicesAsync(int customerId) => Send<List<Invoice>>(HttpMethod.Get, $"api/customers/{customerId}/invoices");

    // Driver
    public Task<Order> StartAsync(int id) => Send<Order>(HttpMethod.Post, $"api/orders/{id}/start");
    public Task SendLocationAsync(int id, GeoPoint p, CancellationToken ct = default) => Send(HttpMethod.Post, $"api/orders/{id}/location", new { lat = p.Lat, lng = p.Lng }, ct);
    public Task<Order> CompleteAsync(int id, CompleteRequest r) => Send<Order>(HttpMethod.Post, $"api/orders/{id}/complete", r);

    private async Task<T> Send<T>(HttpMethod method, string path, object? body = null, CancellationToken ct = default)
    {
        using var res = await SendRaw(method, path, body, ct);
        return (await res.Content.ReadFromJsonAsync<T>(Json, ct))!;
    }

    private async Task Send(HttpMethod method, string path, object? body = null, CancellationToken ct = default)
    {
        using var res = await SendRaw(method, path, body, ct);
    }

    private async Task<HttpResponseMessage> SendRaw(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: Json);
        HttpResponseMessage res;
        try { res = await http.SendAsync(req, ct); }
        catch (HttpRequestException) { throw new ApiException("Can't reach the server. Check your internet connection.", 0); }

        if (res.IsSuccessStatusCode) return res;
        var message = res.StatusCode switch
        {
            HttpStatusCode.Unauthorized => "Please sign in again.",
            HttpStatusCode.Forbidden => "You don't have access to this.",
            HttpStatusCode.TooManyRequests => "Too many tries. Please wait a minute.",
            _ => await ReadError(res) ?? "Something went wrong. Please try again."
        };
        var status = res.StatusCode;
        res.Dispose();
        throw new ApiException(message, status);
    }

    private static async Task<string?> ReadError(HttpResponseMessage res)
    {
        try { return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString(); }
        catch { return null; }
    }
}
