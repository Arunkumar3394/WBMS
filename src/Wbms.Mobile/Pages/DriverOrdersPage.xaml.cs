using Wbms.Client;
using Wbms.Client.ViewModels;

namespace Wbms.Mobile.Pages;

public partial class DriverOrdersPage : ContentPage
{
    private readonly DriverOrdersViewModel vm;

    public DriverOrdersPage(DriverOrdersViewModel vm)
    {
        InitializeComponent();
        BindingContext = this.vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await vm.Load();
    }

    private async void OnSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not Order order) return;
        ((CollectionView)sender!).SelectedItem = null;
        var page = App.Resolve<DeliveryPage>();
        page.Show(order);
        await Navigation.PushAsync(page);
    }

    private async void OnSignOut(object? sender, EventArgs e) => await App.SignOut();
}
