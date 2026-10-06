namespace Wbms.Client;

/// <summary>Keeps the signed-in token across app restarts (MAUI: SecureStorage).</summary>
public interface ISessionStore
{
    Task<TokenResponse?> LoadAsync();
    Task SaveAsync(TokenResponse session);
    Task ClearAsync();
}

public class MemorySessionStore : ISessionStore
{
    private TokenResponse? session;
    public Task<TokenResponse?> LoadAsync() => Task.FromResult(session);
    public Task SaveAsync(TokenResponse s) { session = s; return Task.CompletedTask; }
    public Task ClearAsync() { session = null; return Task.CompletedTask; }
}

/// <summary>Current GPS position (MAUI: Geolocation). Returns null when unavailable or permission is denied.</summary>
public interface ILocationProvider
{
    Task<GeoPoint?> GetAsync(CancellationToken ct);
}

/// <summary>Opens turn-by-turn navigation in Google Maps.</summary>
public static class MapLinks
{
    public static Uri DirectionsTo(double? lat, double? lng, string address) =>
        lat is not null && lng is not null
            ? new Uri($"https://www.google.com/maps/dir/?api=1&destination={lat},{lng}")
            : new Uri($"https://www.google.com/maps/dir/?api=1&destination={Uri.EscapeDataString(address)}");
}
