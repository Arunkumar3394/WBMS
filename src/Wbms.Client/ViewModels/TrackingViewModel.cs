using CommunityToolkit.Mvvm.ComponentModel;

namespace Wbms.Client.ViewModels;

/// <summary>
/// Live view of one order for the customer: driver position and status. The app asks the server for the order every
/// few seconds while the screen is open (the .NET Framework 4.7 API has no push channel).
/// </summary>
public partial class TrackingViewModel(WbmsApi api, TimeSpan? interval = null) : BaseViewModel, IAsyncDisposable
{
    public static readonly TimeSpan DefaultInterval = TimeSpan.FromSeconds(10);

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DriverMapLink), nameof(StatusText))]
    private Order? order;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(DriverMapLink))]
    private GeoPoint? driverLocation;

    [ObservableProperty] private DateTime? lastUpdate;

    private CancellationTokenSource? polling;
    private Task? pollTask;

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
        await Run(() => Refresh(orderId));
        if (Order is null || !Order.IsActive) return;

        polling = new CancellationTokenSource();
        var ct = polling.Token;
        pollTask = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(interval ?? DefaultInterval);
            try
            {
                while (await timer.WaitForNextTickAsync(ct))
                {
                    try
                    {
                        await Refresh(orderId);
                        Error = null;
                        if (Order is { IsActive: false }) break;
                    }
                    catch (ApiException ex) { Error = ex.Message; } // keep trying; the network may come back
                }
            }
            catch (OperationCanceledException) { }
        });
    }

    private async Task Refresh(int orderId)
    {
        Order = await api.OrderAsync(orderId);
        if (Order.DriverLat is { } lat && Order.DriverLng is { } lng && (DriverLocation?.Lat != lat || DriverLocation?.Lng != lng))
        {
            DriverLocation = new GeoPoint(lat, lng);
            LastUpdate = DateTime.Now;
        }
    }

    public async ValueTask DisposeAsync()
    {
        polling?.Cancel();
        if (pollTask is not null) await pollTask;
        polling?.Dispose();
        polling = null;
        pollTask = null;
    }
}
