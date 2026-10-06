using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace Wbms.Client.ViewModels;

/// <summary>Customer home: balance and cans, quick booking, and order history.</summary>
public partial class CustomerViewModel(WbmsApi api) : BaseViewModel
{
    [ObservableProperty] private Profile? profile;
    [ObservableProperty] private Product? selectedProduct;
    [ObservableProperty] private int quantity = 2;
    [ObservableProperty] private bool payOnCredit;
    [ObservableProperty] private string? message;

    public ObservableCollection<Product> Products { get; } = new();
    public ObservableCollection<Order> Orders { get; } = new();
    public ObservableCollection<Invoice> Invoices { get; } = new();

    public decimal Estimate => (SelectedProduct?.Price ?? 0) * Quantity;
    partial void OnSelectedProductChanged(Product? value) => OnPropertyChanged(nameof(Estimate));
    partial void OnQuantityChanged(int value) => OnPropertyChanged(nameof(Estimate));

    [RelayCommand]
    public Task Load() => Run(async () =>
    {
        Profile = await api.MeAsync();
        var products = await api.ProductsAsync();
        Products.Clear();
        foreach (var p in products) Products.Add(p);
        SelectedProduct ??= Products.FirstOrDefault(p => p.IsReturnable) ?? Products.FirstOrDefault();
        await ReloadOrders();
    });

    [RelayCommand]
    private Task Book() => Run(async () =>
    {
        Message = null;
        if (SelectedProduct is null || Quantity <= 0) throw new ApiException("Choose a product and quantity.", 0);
        var address = Profile?.Addresses.FirstOrDefault(a => a.IsDefault) ?? Profile?.Addresses.FirstOrDefault()
            ?? throw new ApiException("Add a delivery address first.", 0);
        var order = await api.BookAsync(new BookRequest(address.Id, PayOnCredit ? PaymentMode.Credit : PaymentMode.Cash,
            DateOnly.FromDateTime(DateTime.Today), [new OrderLine(SelectedProduct.Id, Quantity)], null));
        Message = $"Order {order.OrderNo} booked. We'll confirm it shortly.";
        await ReloadOrders();
    });

    [RelayCommand]
    private Task Cancel(Order order) => Run(async () =>
    {
        await api.CancelAsync(order.Id);
        await ReloadOrders();
    });

    private async Task ReloadOrders()
    {
        var orders = await api.OrdersAsync();
        Orders.Clear();
        foreach (var o in orders) Orders.Add(o);
        Profile = await api.MeAsync(); // dues and cans change as orders complete
        if (Profile.CustomerId is { } customerId)
        {
            var invoices = await api.InvoicesAsync(customerId);
            Invoices.Clear();
            foreach (var i in invoices) Invoices.Add(i);
        }
    }
}
