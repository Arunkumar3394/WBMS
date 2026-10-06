using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Wbms.Api.Hubs;
using Wbms.Core.Entities;
using Wbms.Data;
using Wbms.Data.Services;

namespace Wbms.Api.Controllers;

[ApiController]
[Route("api/orders")]
public class OrdersController(WbmsDbContext db, OrderService orders, IHubContext<TrackingHub> hub) : ControllerBase
{
    [HttpGet]
    public async Task<List<OrderDto>> List(OrderStatus? status, int? customerId, int? driverId, DateOnly? date)
    {
        var q = Query();
        if (status is not null) q = q.Where(o => o.Status == status);
        if (customerId is not null) q = q.Where(o => o.CustomerId == customerId);
        if (driverId is not null) q = q.Where(o => o.Delivery != null && o.Delivery.DriverId == driverId);
        if (date is not null) q = q.Where(o => o.SlotDate == date);
        return (await q.OrderByDescending(o => o.CreatedAt).Take(500).ToListAsync()).Select(ToDto).ToList();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<OrderDto>> Get(int id) =>
        await Query().FirstOrDefaultAsync(o => o.Id == id) is { } o ? ToDto(o) : NotFound();

    /// <summary>Customer books water.</summary>
    [HttpPost]
    public async Task<OrderDto> Book(BookOrderRequest req) => await Reload((await orders.BookAsync(req)).Id);

    [HttpPost("{id:int}/payment")]
    public async Task<OrderDto> Pay(int id, OnlinePaymentRequest req) => await Reload((await orders.RecordOnlinePaymentAsync(id, req.Amount, req.Reference)).Id);

    [HttpPost("{id:int}/confirm")]
    public async Task<OrderDto> Confirm(int id) => await Reload((await orders.ConfirmAsync(id)).Id);

    [HttpPost("{id:int}/assign")]
    public async Task<OrderDto> Assign(int id, AssignRequest req) => await Reload((await orders.AssignAsync(id, req.DriverId)).Id);

    [HttpPost("{id:int}/cancel")]
    public async Task<OrderDto> Cancel(int id) => await Reload((await orders.CancelAsync(id)).Id);

    // Driver actions. TODO: take driverId from the signed-in driver's token once auth is added.
    [HttpPost("{id:int}/start")]
    public async Task<OrderDto> Start(int id, [FromQuery] int driverId) => await Reload((await orders.StartDeliveryAsync(id, driverId)).Id);

    [HttpPost("{id:int}/location")]
    public async Task<IActionResult> Location(int id, [FromQuery] int driverId, LocationRequest req)
    {
        var d = await orders.RecordLocationAsync(id, driverId, req.Lat, req.Lng);
        await hub.Clients.Group(TrackingHub.Group(id)).SendAsync("location", new { orderId = id, lat = d.LastLat, lng = d.LastLng, at = d.LastLocationAt });
        return NoContent();
    }

    [HttpPost("{id:int}/complete")]
    public async Task<OrderDto> Complete(int id, [FromQuery] int driverId, CompleteDeliveryRequest req)
    {
        var dto = await Reload((await orders.CompleteDeliveryAsync(id, driverId, req)).Id);
        await hub.Clients.Group(TrackingHub.Group(id)).SendAsync("status", new { orderId = id, status = dto.Status.ToString() });
        return dto;
    }

    private IQueryable<Order> Query() => db.Orders.AsNoTracking()
        .Include(o => o.Customer).ThenInclude(c => c.User)
        .Include(o => o.Address)
        .Include(o => o.Items).ThenInclude(i => i.Product)
        .Include(o => o.Delivery).ThenInclude(d => d!.Driver).ThenInclude(d => d.User)
        .Include(o => o.Invoice);

    private async Task<OrderDto> Reload(int id) => ToDto(await Query().FirstAsync(o => o.Id == id));

    private static OrderDto ToDto(Order o) => new(o.Id, o.OrderNo, o.CustomerId, o.Customer.User.Name,
        $"{o.Address.Line}, {o.Address.Area}", o.Status, o.PaymentMode, o.Total, o.SlotDate,
        o.Delivery?.DriverId, o.Delivery?.Driver.User.Name,
        o.Items.Select(i => new OrderItemDto(i.ProductId, i.Product.Name, i.Qty, i.UnitPrice)).ToList(),
        o.Delivery?.LastLat, o.Delivery?.LastLng, o.Invoice?.InvoiceNo);
}
