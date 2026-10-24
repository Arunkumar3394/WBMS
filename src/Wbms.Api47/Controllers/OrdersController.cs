using System;
using System.Collections.Generic;
using System.Data.Entity;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Http;
using Wbms.Api47.Entities;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;

namespace Wbms.Api47.Controllers;

[RoutePrefix("api/orders")]
public class OrdersController : WbmsController
{
    /// <summary>
    /// Staff see every order; customers see their own; drivers see the orders assigned to them.
    /// status takes one status or several separated by commas (e.g. Placed,Paid,OnCredit).
    /// </summary>
    [HttpGet, Route("")]
    public async Task<List<OrderDto>> List(string? status = null, int? customerId = null, int? driverId = null, DateTime? date = null)
    {
        var q = Visible(Query());
        if (!string.IsNullOrWhiteSpace(status))
        {
            var statuses = new List<OrderStatus>();
            foreach (var s in status!.Split(','))
                statuses.Add(Enum.TryParse<OrderStatus>(s.Trim(), true, out var st) ? st : throw new WorkflowException($"Unknown status '{s}'."));
            q = q.Where(o => statuses.Contains(o.Status));
        }
        if (customerId != null) q = q.Where(o => o.CustomerId == customerId);
        if (driverId != null) q = q.Where(o => o.Delivery != null && o.Delivery.DriverId == driverId);
        if (date != null)
        {
            var day = date.Value.Date;
            q = q.Where(o => o.SlotDate == day);
        }
        return (await q.OrderByDescending(o => o.CreatedAt).Take(500).ToListAsync()).Select(ToDto).ToList();
    }

    [HttpGet, Route("{id:int}")]
    public async Task<IHttpActionResult> Get(int id) =>
        await Visible(Query()).FirstOrDefaultAsync(o => o.Id == id) is { } o ? Ok(ToDto(o)) : (IHttpActionResult)NotFound();

    /// <summary>Customers book for themselves; staff book phone orders by passing CustomerId.</summary>
    [HttpPost, Route(""), RequireRole(Roles.Staff + "," + Roles.Customer)]
    public async Task<OrderDto> Book(BookRequest r)
    {
        var customerId = User.IsStaff() && r.CustomerId is { } c ? c : User.RequireCustomerId();
        var order = await Orders.BookAsync(new BookOrderRequest(customerId, r.AddressId, r.PaymentMode, r.SlotDate, r.Items, r.Notes));
        return await Reload(order.Id);
    }

    /// <summary>Manual record of an online payment (e.g. UPI screenshot checked by staff). Razorpay uses the webhook.</summary>
    [HttpPost, Route("{id:int}/payment"), RequireRole(Roles.Staff)]
    public async Task<OrderDto> Pay(int id, OnlinePaymentRequest r) => await Reload((await Orders.RecordOnlinePaymentAsync(id, r.Amount, r.Reference)).Id);

    [HttpPost, Route("{id:int}/confirm"), RequireRole(Roles.Staff)]
    public async Task<OrderDto> Confirm(int id) => await Reload((await Orders.ConfirmAsync(id)).Id);

    [HttpPost, Route("{id:int}/assign"), RequireRole(Roles.Staff)]
    public async Task<OrderDto> Assign(int id, AssignRequest r) => await Reload((await Orders.AssignAsync(id, r.DriverId)).Id);

    /// <summary>Staff can cancel any open order; a customer can cancel their own order until it is confirmed.</summary>
    [HttpPost, Route("{id:int}/cancel"), RequireRole(Roles.Staff + "," + Roles.Customer)]
    public async Task<IHttpActionResult> Cancel(int id)
    {
        if (!User.IsStaff())
        {
            var customerId = User.RequireCustomerId();
            var o = await Db.Orders.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.CustomerId == customerId);
            if (o == null) return NotFound();
            if (o.Status != OrderStatus.Placed && o.Status != OrderStatus.PaymentPending && o.Status != OrderStatus.OnCredit)
                throw new WorkflowException("This order is already confirmed. Please call us to cancel.");
        }
        return Ok(await Reload((await Orders.CancelAsync(id)).Id));
    }

    [HttpPost, Route("{id:int}/start"), RequireRole(Roles.Driver)]
    public async Task<OrderDto> Start(int id) => await Reload((await Orders.StartDeliveryAsync(id, User.RequireDriverId())).Id);

    [HttpPost, Route("{id:int}/resend-otp"), RequireRole(Roles.Driver)]
    public async Task<IHttpActionResult> ResendOtp(int id)
    {
        await Orders.ResendDeliveryOtpAsync(id, User.RequireDriverId());
        return NoContent();
    }

    /// <summary>Driver's phone reports its position while out for delivery; customers see it by polling the order.</summary>
    [HttpPost, Route("{id:int}/location"), RequireRole(Roles.Driver)]
    public async Task<IHttpActionResult> Location(int id, LocationRequest r)
    {
        await Orders.RecordLocationAsync(id, User.RequireDriverId(), r.Lat, r.Lng);
        return NoContent();
    }

    [HttpPost, Route("{id:int}/complete"), RequireRole(Roles.Driver)]
    public async Task<OrderDto> Complete(int id, CompleteDeliveryRequest r) =>
        await Reload((await Orders.CompleteDeliveryAsync(id, User.RequireDriverId(), r)).Id);

    private IQueryable<Order> Visible(IQueryable<Order> q)
    {
        if (User.IsStaff()) return q;
        if (User.GetDriverId() is { } driverId) return q.Where(o => o.Delivery != null && o.Delivery.DriverId == driverId);
        if (User.GetCustomerId() is { } customerId) return q.Where(o => o.CustomerId == customerId);
        return q.Where(o => false);
    }

    private IQueryable<Order> Query() => Db.Orders.AsNoTracking()
        .Include(o => o.Customer.User)
        .Include(o => o.Address)
        .Include(o => o.Items.Select(i => i.Product))
        .Include(o => o.Delivery!.Driver.User)
        .Include(o => o.Invoice);

    private async Task<OrderDto> Reload(int id) => ToDto(await Query().FirstAsync(o => o.Id == id));

    public static OrderDto ToDto(Order o) => new OrderDto(o.Id, o.OrderNo, o.CustomerId, o.Customer.User.Name, o.Customer.User.Phone,
        $"{o.Address.Line}, {o.Address.Area}".TrimEnd(' ', ','), o.Address.Lat, o.Address.Lng, o.Status, o.PaymentMode, o.Total,
        o.SlotDate.ToString("yyyy-MM-dd"),
        o.Delivery?.DriverId, o.Delivery?.Driver.User.Name, o.Delivery?.Driver.User.Phone,
        o.Items.Select(i => new OrderItemDto(i.ProductId, i.Product.Name, i.Qty, i.UnitPrice)).ToList(),
        o.Delivery?.LastLat, o.Delivery?.LastLng, o.Delivery?.LastLocationAt, o.Invoice?.InvoiceNo, o.Invoice?.OrderId, o.Notes, o.CreatedAt);
}
