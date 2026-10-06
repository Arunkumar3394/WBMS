using Microsoft.AspNetCore.SignalR;

namespace Wbms.Api.Hubs;

/// <summary>Customers and admins join an order's group to receive live driver locations.</summary>
public class TrackingHub : Hub
{
    public Task WatchOrder(int orderId) => Groups.AddToGroupAsync(Context.ConnectionId, Group(orderId));
    public Task UnwatchOrder(int orderId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(orderId));
    public static string Group(int orderId) => $"order-{orderId}";
}
