using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace Wbms.Client.ViewModels;

/// <summary>
/// One delivery on the driver's phone: start (customer gets the OTP), share GPS while driving,
/// then enter the OTP, can counts and cash to complete.
/// </summary>
public partial class DeliveryViewModel(WbmsApi api, ILocationProvider location) : BaseViewModel
{
    public static readonly TimeSpan LocationInterval = TimeSpan.FromSeconds(15);

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanStart), nameof(CanComplete), nameof(IsDone))]
    private Order? order;

    [ObservableProperty] private string otp = "";
    [ObservableProperty] private int fullCansDelivered;
    [ObservableProperty] private int emptyCansCollected;
    [ObservableProperty] private decimal cashCollected;
    [ObservableProperty] private DateTime? lastLocationSentAt;

    private CancellationTokenSource? tracking;

    public bool CanStart => Order?.Status == OrderStatus.Assigned;
    public bool CanComplete => Order?.Status == OrderStatus.OutForDelivery;
    public bool IsDone => Order?.Status == OrderStatus.Completed;
    public bool IsTracking => tracking is not null;
    public Uri? Directions => Order is null ? null : MapLinks.DirectionsTo(Order.AddressLat, Order.AddressLng, Order.Address);

    public void Load(Order o)
    {
        Order = o;
        Otp = "";
        // Sensible defaults the driver can change: all ordered cans, cash due if paying by cash.
        FullCansDelivered = o.Items.Sum(i => i.Qty);
        EmptyCansCollected = FullCansDelivered;
        CashCollected = o.PaymentMode == PaymentMode.Cash ? o.Total : 0;
        if (o.Status == OrderStatus.OutForDelivery) StartTracking();
    }

    [ObservableProperty] private string? info;

    [RelayCommand]
    private Task Start() => Run(async () =>
    {
        try
        {
            Order = await api.StartAsync(Order!.Id);
        }
        catch (ApiException)
        {
            // The trip may have started even if the SMS failed; show the real state so "Resend code" is available.
            Order = await api.OrderAsync(Order!.Id);
            if (Order.Status == OrderStatus.OutForDelivery) StartTracking();
            throw;
        }
        StartTracking();
    });

    [RelayCommand]
    private Task ResendCode() => Run(async () =>
    {
        Info = null;
        await api.ResendOtpAsync(Order!.Id);
        Info = "New code sent to the customer.";
    });

    [RelayCommand]
    private Task Complete() => Run(async () =>
    {
        if (Otp.Trim().Length != 4) throw new ApiException("Enter the 4-digit code from the customer.", 0);
        Order = await api.CompleteAsync(Order!.Id, new CompleteRequest(Otp.Trim(), FullCansDelivered, EmptyCansCollected, CashCollected));
        StopTracking();
    });

    /// <summary>Sends the phone's location every 15 seconds while the delivery is in progress.</summary>
    public void StartTracking()
    {
        if (tracking is not null || Order is null) return;
        tracking = new CancellationTokenSource();
        OnPropertyChanged(nameof(IsTracking));
        _ = TrackLoop(Order.Id, tracking.Token);
    }

    public void StopTracking()
    {
        tracking?.Cancel();
        tracking = null;
        OnPropertyChanged(nameof(IsTracking));
    }

    /// <summary>Sends one location update now. Returns false if no fix or the server refused it.</summary>
    public async Task<bool> SendLocationOnceAsync(int orderId, CancellationToken ct)
    {
        var p = await location.GetAsync(ct);
        if (p is null) return false;
        try
        {
            await api.SendLocationAsync(orderId, p, ct);
            LastLocationSentAt = DateTime.Now;
            return true;
        }
        catch (ApiException) { return false; } // keep trying; network drops are normal on the road
    }

    private async Task TrackLoop(int orderId, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await SendLocationOnceAsync(orderId, ct);
                await Task.Delay(LocationInterval, ct);
            }
        }
        catch (OperationCanceledException) { }
    }
}
