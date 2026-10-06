using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Wbms.Api.Auth;
using Wbms.Data;

namespace Wbms.Api.Hubs;

/// <summary>Customers and staff join an order's group to receive live driver locations and status changes.</summary>
[Authorize]
public class TrackingHub(WbmsDbContext db) : Hub
{
    public async Task WatchOrder(int orderId)
    {
        var user = Context.User!;
        var allowed = user.IsStaff() || await db.Orders.AnyAsync(o => o.Id == orderId &&
            (o.CustomerId == user.GetCustomerId() || (o.Delivery != null && o.Delivery.DriverId == user.GetDriverId())));
        if (!allowed) throw new HubException("You can't track this order.");
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(orderId));
    }

    public Task UnwatchOrder(int orderId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(orderId));
    public static string Group(int orderId) => $"order-{orderId}";
}
