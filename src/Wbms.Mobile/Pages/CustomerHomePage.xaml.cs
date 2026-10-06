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
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await vm.Load();
    }

    private async void OnOrderTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not Order order) return;
        if (order.IsActive && order.Status is OrderStatus.Placed or OrderStatus.OnCredit or OrderStatus.PaymentPending)
        {
            var choice = await DisplayActionSheet(order.OrderNo, "Close", null, "Track order", "Cancel order");
            if (choice == "Cancel order") { await vm.CancelCommand.ExecuteAsync(order); return; }
            if (choice != "Track order") return;
        }
        var page = App.Resolve<TrackingPage>();
        await Navigation.PushAsync(page);
        await page.Start(order.Id);
    }

    private async void OnSignOut(object? sender, EventArgs e) => await App.SignOut();
}
