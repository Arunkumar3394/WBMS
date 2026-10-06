using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.Input;

namespace Wbms.Client.ViewModels;

/// <summary>The driver's list: orders assigned to them and not yet completed.</summary>
public partial class DriverOrdersViewModel(WbmsApi api) : BaseViewModel
{
    public ObservableCollection<Order> Orders { get; } = new();

    [RelayCommand]
    public Task Load() => Run(async () =>
    {
        var all = await api.OrdersAsync();
        Orders.Clear();
        foreach (var o in all.Where(o => o.Status is OrderStatus.Assigned or OrderStatus.OutForDelivery)
                     .OrderByDescending(o => o.Status == OrderStatus.OutForDelivery).ThenBy(o => o.SlotDate))
            Orders.Add(o);
    });
}
