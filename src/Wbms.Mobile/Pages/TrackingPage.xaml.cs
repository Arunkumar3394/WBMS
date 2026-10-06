using Wbms.Client.ViewModels;

namespace Wbms.Mobile.Pages;

public partial class TrackingPage : ContentPage
{
    private readonly TrackingViewModel vm;

    public TrackingPage(TrackingViewModel vm)
    {
        InitializeComponent();
        BindingContext = this.vm = vm;
    }

    public Task Start(int orderId) => vm.StartAsync(orderId);

    protected override async void OnDisappearing()
    {
        base.OnDisappearing();
        await vm.DisposeAsync();
    }

    private async void OnShowMap(object? sender, EventArgs e)
    {
        if (vm.DriverMapLink is { } uri) await Launcher.Default.OpenAsync(uri);
    }
}
