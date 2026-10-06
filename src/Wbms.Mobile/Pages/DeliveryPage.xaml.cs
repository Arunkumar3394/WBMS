using Wbms.Client;
using Wbms.Client.ViewModels;

namespace Wbms.Mobile.Pages;

public partial class DeliveryPage : ContentPage
{
    private readonly DeliveryViewModel vm;

    public DeliveryPage(DeliveryViewModel vm)
    {
        InitializeComponent();
        BindingContext = this.vm = vm;
    }

    public void Show(Order order) => vm.Load(order);

    // Location is only shared while this screen is open (no background service yet).
    protected override void OnAppearing()
    {
        base.OnAppearing();
        if (vm.CanComplete) vm.StartTracking();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        vm.StopTracking();
    }

    private void OnCall(object? sender, EventArgs e)
    {
        if (vm.Order is { } o && PhoneDialer.Default.IsSupported) PhoneDialer.Default.Open(o.CustomerPhone);
    }

    private async void OnNavigate(object? sender, EventArgs e)
    {
        if (vm.Directions is { } uri) await Launcher.Default.OpenAsync(uri);
    }
}
