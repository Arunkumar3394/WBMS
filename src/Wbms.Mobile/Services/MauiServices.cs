using System.Text.Json;
using Wbms.Client;

namespace Wbms.Mobile.Services;

/// <summary>Keeps the sign-in token in the phone's secure storage.</summary>
public class SecureSessionStore : ISessionStore
{
    private const string Key = "wbms_session";

    public async Task<TokenResponse?> LoadAsync()
    {
        try
        {
            var json = await SecureStorage.Default.GetAsync(Key);
            return json is null ? null : JsonSerializer.Deserialize<TokenResponse>(json, WbmsApi.Json);
        }
        catch { return null; }
    }

    public Task SaveAsync(TokenResponse session) => SecureStorage.Default.SetAsync(Key, JsonSerializer.Serialize(session, WbmsApi.Json));

    public Task ClearAsync()
    {
        SecureStorage.Default.Remove(Key);
        return Task.CompletedTask;
    }
}

/// <summary>Reads GPS while the app is open, asking for permission the first time.</summary>
public class DeviceLocationProvider : ILocationProvider
{
    public async Task<GeoPoint?> GetAsync(CancellationToken ct)
    {
        try
        {
            var status = await MainThread.InvokeOnMainThreadAsync(async () =>
            {
                var s = await Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>();
                return s == PermissionStatus.Granted ? s : await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
            });
            if (status != PermissionStatus.Granted) return null;

            var loc = await Geolocation.Default.GetLocationAsync(new GeolocationRequest(GeolocationAccuracy.Medium, TimeSpan.FromSeconds(10)), ct);
            return loc is null ? null : new GeoPoint(loc.Latitude, loc.Longitude);
        }
        catch (Exception ex) when (ex is FeatureNotEnabledException or FeatureNotSupportedException or PermissionException)
        {
            return null;
        }
    }
}
