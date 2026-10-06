using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Wbms.Api.Auth;
using Wbms.Api.Hubs;
using Wbms.Core.Entities;
using Wbms.Data;
using Wbms.Data.Services;

namespace Wbms.Api.Controllers;

public record BookRequest(int AddressId, PaymentMode PaymentMode, DateOnly SlotDate, List<OrderLine> Items, string? Notes, int? CustomerId);

[ApiController]
[Route("api/orders")]
[Authorize]
public class OrdersController(WbmsDbContext db, OrderService orders, IHubContext<TrackingHub> hub) : ControllerBase
{
    /// <summary>Staff see every order; customers see their own; drivers see the orders assigned to them.</summary>
    [HttpGet]
    public async Task<List<OrderDto>> List(OrderStatus? status, int? customerId, int? driverId, DateOnly? date)
    {
        var q = Visible(Query());
        if (status is not null) q = q.Where(o => o.Status == status);
        if (customerId is not null) q = q.Where(o => o.CustomerId == customerId);
        if (driverId is not null) q = q.Where(o => o.Delivery != null && o.Delivery.DriverId == driverId);
        if (date is not null) q = q.Where(o => o.SlotDate == date);
        return (await q.OrderByDescending(o => o.CreatedAt).Take(500).ToListAsync()).Select(ToDto).ToList();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<OrderDto>> Get(int id) =>
        await Visible(Query()).FirstOrDefaultAsync(o => o.Id == id) is { } o ? ToDto(o) : NotFound();

    /// <summary>Customers book for themselves; staff book phone orders by passing CustomerId.</summary>
    [HttpPost]
    [Authorize(Roles = Roles.Staff + "," + Roles.Customer)]
    public async Task<OrderDto> Book(BookRequest r)
    {
        var customerId = User.IsStaff() && r.CustomerId is { } c ? c : User.RequireCustomerId();
        var order = await orders.BookAsync(new BookOrderRequest(customerId, r.AddressId, r.PaymentMode, r.SlotDate, r.Items, r.Notes));
        return await Reload(order.Id);
    }

    /// <summary>Manual record of an online payment (e.g. UPI screenshot checked by staff). Razorpay uses the webhook.</summary>
    [HttpPost("{id:int}/payment")]
    [Authorize(Roles = Roles.Staff)]
    public async Task<OrderDto> Pay(int id, OnlinePaymentRequest req) => await Reload((await orders.RecordOnlinePaymentAsync(id, req.Amount, req.Reference)).Id);

    [HttpPost("{id:int}/confirm")]
    [Authorize(Roles = Roles.Staff)]
    public async Task<OrderDto> Confirm(int id) => await Reload((await orders.ConfirmAsync(id)).Id);

    [HttpPost("{id:int}/assign")]
    [Authorize(Roles = Roles.Staff)]
    public async Task<OrderDto> Assign(int id, AssignRequest req) => await Reload((await orders.AssignAsync(id, req.DriverId)).Id);

    /// <summary>Staff can cancel any open order; a customer can cancel their own order until it is confirmed.</summary>
    [HttpPost("{id:int}/cancel")]
    [Authorize(Roles = Roles.Staff + "," + Roles.Customer)]
    public async Task<ActionResult<OrderDto>> Cancel(int id)
    {
        if (!User.IsStaff())
        {
            var o = await db.Orders.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.CustomerId == User.RequireCustomerId());
            if (o is null) return NotFound();
            if (o.Status is not (OrderStatus.Placed or OrderStatus.PaymentPending or OrderStatus.OnCredit))
                return BadRequest(new { error = "This order is already confirmed. Please call us to cancel." });
        }
        return await Reload((await orders.CancelAsync(id)).Id);
    }

    [HttpPost("{id:int}/start")]
    [Authorize(Roles = Roles.Driver)]
    public async Task<OrderDto> Start(int id) => await Reload((await orders.StartDeliveryAsync(id, User.RequireDriverId())).Id);

    [HttpPost("{id:int}/location")]
    [Authorize(Roles = Roles.Driver)]
    public async Task<IActionResult> Location(int id, LocationRequest req)
    {
        var d = await orders.RecordLocationAsync(id, User.RequireDriverId(), req.Lat, req.Lng);
        await hub.Clients.Group(TrackingHub.Group(id)).SendAsync("location", new { orderId = id, lat = d.LastLat, lng = d.LastLng, at = d.LastLocationAt });
        return NoContent();
    }

    [HttpPost("{id:int}/complete")]
    [Authorize(Roles = Roles.Driver)]
    public async Task<OrderDto> Complete(int id, CompleteDeliveryRequest req)
    {
        var dto = await Reload((await orders.CompleteDeliveryAsync(id, User.RequireDriverId(), req)).Id);
        await hub.Clients.Group(TrackingHub.Group(id)).SendAsync("status", new { orderId = id, status = dto.Status.ToString() });
        return dto;
    }

    private IQueryable<Order> Visible(IQueryable<Order> q)
    {
        if (User.IsStaff()) return q;
        if (User.GetDriverId() is { } driverId) return q.Where(o => o.Delivery != null && o.Delivery.DriverId == driverId);
        if (User.GetCustomerId() is { } customerId) return q.Where(o => o.CustomerId == customerId);
        return q.Where(_ => false);
    }

    private IQueryable<Order> Query() => db.Orders.AsNoTracking()
        .Include(o => o.Customer).ThenInclude(c => c.User)
        .Include(o => o.Address)
        .Include(o => o.Items).ThenInclude(i => i.Product)
        .Include(o => o.Delivery).ThenInclude(d => d!.Driver).ThenInclude(d => d.User)
        .Include(o => o.Invoice);

    private async Task<OrderDto> Reload(int id) => ToDto(await Query().FirstAsync(o => o.Id == id));

    private static OrderDto ToDto(Order o) => new(o.Id, o.OrderNo, o.CustomerId, o.Customer.User.Name, o.Customer.User.Phone,
        $"{o.Address.Line}, {o.Address.Area}", o.Address.Lat, o.Address.Lng, o.Status, o.PaymentMode, o.Total, o.SlotDate,
        o.Delivery?.DriverId, o.Delivery?.Driver.User.Name,
        o.Items.Select(i => new OrderItemDto(i.ProductId, i.Product.Name, i.Qty, i.UnitPrice)).ToList(),
        o.Delivery?.LastLat, o.Delivery?.LastLng, o.Invoice?.InvoiceNo);
}
