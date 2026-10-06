using Wbms.Client;
using Wbms.Client.ViewModels;

namespace Wbms.Mobile.Pages;

public partial class CustomerHomePage : ContentPage
{
    private readonly CustomerViewModel vm;

    public CustomerHomePage(CustomerViewModel vm)
    {
        InitializeComponent();
        BindingContext = this.vm = vm;
        vm.OpenPayment += async uri => await Launcher.Default.OpenAsync(uri);
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await vm.Load();
    }

    private async void OnOrderTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not Order order) return;
        if (order.Status is OrderStatus.Placed or OrderStatus.OnCredit or OrderStatus.PaymentPending)
        {
            var actions = order.Status == OrderStatus.PaymentPending
                ? new[] { "Pay now", "Track order", "Cancel order" }
                : new[] { "Track order", "Cancel order" };
            var choice = await DisplayActionSheet(order.OrderNo, "Close", null, actions);
            if (choice == "Cancel order") { await vm.CancelCommand.ExecuteAsync(order); return; }
            if (choice == "Pay now") { await vm.PayOnlineCommand.ExecuteAsync(order); return; }
            if (choice != "Track order") return;
        }
        var page = App.Resolve<TrackingPage>();
        await Navigation.PushAsync(page);
        await page.Start(order.Id);
    }

    /// <summary>Downloads the invoice PDF and opens it in the phone's PDF viewer.</summary>
    private async void OnInvoiceTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not Invoice invoice) return;
        try
        {
            var bytes = await App.Resolve<WbmsApi>().InvoicePdfAsync(invoice.Id);
            var path = Path.Combine(FileSystem.CacheDirectory, $"{invoice.InvoiceNo}.pdf");
            await File.WriteAllBytesAsync(path, bytes);
            await Launcher.Default.OpenAsync(new OpenFileRequest(invoice.InvoiceNo, new ReadOnlyFile(path, "application/pdf")));
        }
        catch (ApiException ex)
        {
            await DisplayAlert("Invoice", ex.Message, "OK");
        }
    }

    private async void OnSignOut(object? sender, EventArgs e) => await App.SignOut();
}
