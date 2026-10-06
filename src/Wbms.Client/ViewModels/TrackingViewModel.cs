using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.AspNetCore.Http.Connections.Client;
using Microsoft.AspNetCore.SignalR.Client;

namespace Wbms.Client.ViewModels;

/// <summary>Live view of one order for the customer: driver position and status, pushed by the server.</summary>
public partial class TrackingViewModel(WbmsApi api, Action<HttpConnectionOptions>? configure = null) : BaseViewModel, IAsyncDisposable
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DriverMapLink), nameof(StatusText))]
    private Order? order;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DriverMapLink))]
    private GeoPoint? driverLocation;

    [ObservableProperty] private DateTime? lastUpdate;

    private HubConnection? hub;

    public Uri? DriverMapLink => DriverLocation is { } p ? new Uri($"https://www.google.com/maps/search/?api=1&query={p.Lat},{p.Lng}") : null;

    public string StatusText => Order?.Status switch
    {
        OrderStatus.Placed or OrderStatus.OnCredit or OrderStatus.Paid => "Waiting for confirmation",
        OrderStatus.PaymentPending => "Waiting for payment",
        OrderStatus.Confirmed => "Confirmed, assigning a driver",
        OrderStatus.Assigned => $"{Order.DriverName} will deliver your order",
        OrderStatus.OutForDelivery => $"{Order.DriverName} is on the way. Share the 4-digit code we sent you by SMS when the cans arrive.",
        OrderStatus.Delivered or OrderStatus.Completed => "Delivered. Thank you!",
        OrderStatus.Cancelled => "Cancelled",
        _ => ""
    };

    public async Task StartAsync(int orderId)
    {
        await Run(async () =>
        {
            Order = await api.OrderAsync(orderId);
            if (Order.DriverLat is { } lat && Order.DriverLng is { } lng) DriverLocation = new GeoPoint(lat, lng);
        });
        if (Order is null || !Order.IsActive) return;

        hub = new HubConnectionBuilder()
            .WithUrl(new Uri(api.BaseAddress, "hubs/tracking"), o =>
            {
                o.AccessTokenProvider = () => Task.FromResult(api.Token);
                configure?.Invoke(o);
            })
            .WithAutomaticReconnect()
            .Build();

        hub.On<LocationMessage>("location", m =>
        {
            DriverLocation = new GeoPoint(m.Lat, m.Lng);
            LastUpdate = DateTime.Now;
        });
        hub.On<StatusMessage>("status", async _ => Order = await api.OrderAsync(orderId));
        hub.Reconnected += async _ => await hub.InvokeAsync("WatchOrder", orderId);

        try
        {
            await hub.StartAsync();
            await hub.InvokeAsync("WatchOrder", orderId);
        }
        catch (Exception)
        {
            Error = "Live tracking is unavailable right now. Pull to refresh.";
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (hub is not null) await hub.DisposeAsync();
        hub = null;
    }

    private record LocationMessage(int OrderId, double Lat, double Lng, DateTime? At);
    private record StatusMessage(int OrderId, string Status);
}
