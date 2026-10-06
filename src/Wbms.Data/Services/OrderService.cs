using Microsoft.EntityFrameworkCore;
using Wbms.Core.Entities;
using Wbms.Core.Services;

namespace Wbms.Data.Services;

public record OrderLine(int ProductId, int Qty);
public record BookOrderRequest(int CustomerId, int AddressId, PaymentMode PaymentMode, DateOnly SlotDate, List<OrderLine> Items, string? Notes);
public record CompleteDeliveryRequest(string Otp, int FullCansDelivered, int EmptyCansCollected, decimal CashCollected);

/// <summary>Moves an order through the WBMS delivery flow and keeps cans, stock, payments and invoices in step.</summary>
public class OrderService(WbmsDbContext db, IOtpSender otpSender)
{
    public async Task<Order> BookAsync(BookOrderRequest req)
    {
        if (req.Items.Count == 0 || req.Items.Any(i => i.Qty <= 0))
            throw new WorkflowException("Order needs at least one item with a positive quantity.");

        var customer = await db.Customers.Include(c => c.Addresses).FirstOrDefaultAsync(c => c.Id == req.CustomerId)
            ?? throw new WorkflowException("Customer not found.");
        if (customer.Addresses.All(a => a.Id != req.AddressId))
            throw new WorkflowException("Address does not belong to this customer.");

        var ids = req.Items.Select(i => i.ProductId).ToList();
        var products = await db.Products.Where(p => ids.Contains(p.Id) && p.IsActive).ToDictionaryAsync(p => p.Id);
        if (products.Count != ids.Distinct().Count()) throw new WorkflowException("Unknown or inactive product.");

        var order = new Order
        {
            OrderNo = $"WB{DateTime.UtcNow:yyMMddHHmmss}{Random.Shared.Next(100, 999)}",
            CustomerId = customer.Id,
            AddressId = req.AddressId,
            PaymentMode = req.PaymentMode,
            SlotDate = req.SlotDate,
            Notes = req.Notes,
            Items = req.Items.Select(i => new OrderItem { ProductId = i.ProductId, Qty = i.Qty, UnitPrice = products[i.ProductId].Price }).ToList()
        };
        order.Total = order.Items.Sum(i => i.Qty * i.UnitPrice);

        switch (req.PaymentMode)
        {
            case PaymentMode.Credit:
                if (customer.Balance + order.Total > customer.CreditLimit)
                    throw new WorkflowException($"Credit limit exceeded. Available credit: {customer.CreditLimit - customer.Balance:0.00}.");
                order.Status = OrderStatus.OnCredit;
                break;
            case PaymentMode.Cash:
                order.Status = OrderStatus.Placed; // collected by the driver on delivery
                break;
            default:
                order.Status = OrderStatus.PaymentPending; // awaiting Razorpay/UPI confirmation
                break;
        }

        db.Orders.Add(order);
        await db.SaveChangesAsync();
        return order;
    }

    public async Task<Order> RecordOnlinePaymentAsync(int orderId, decimal amount, string reference)
    {
        var order = await Get(orderId);
        Require(order, OrderStatus.PaymentPending);
        if (amount != order.Total) throw new WorkflowException("Paid amount does not match the order total.");
        db.Payments.Add(new Payment { CustomerId = order.CustomerId, OrderId = order.Id, Amount = amount, Mode = order.PaymentMode, Reference = reference });
        order.Status = OrderStatus.Paid;
        await db.SaveChangesAsync();
        return order;
    }

    public async Task<Order> ConfirmAsync(int orderId)
    {
        var order = await Get(orderId);
        Require(order, OrderStatus.Placed, OrderStatus.Paid, OrderStatus.OnCredit);
        order.Status = OrderStatus.Confirmed;
        order.ConfirmedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return order;
    }

    public async Task<Order> AssignAsync(int orderId, int driverId)
    {
        var order = await Get(orderId);
        Require(order, OrderStatus.Confirmed, OrderStatus.Assigned);
        if (!await db.Drivers.AnyAsync(d => d.Id == driverId)) throw new WorkflowException("Driver not found.");

        if (order.Delivery is null) order.Delivery = new Delivery { OrderId = order.Id, DriverId = driverId };
        else order.Delivery.DriverId = driverId;
        order.Status = OrderStatus.Assigned;
        await db.SaveChangesAsync();
        return order;
    }

    /// <summary>Driver starts the trip: generates the OTP and texts it to the customer.</summary>
    public async Task<Order> StartDeliveryAsync(int orderId, int driverId)
    {
        var order = await Get(orderId);
        Require(order, OrderStatus.Assigned);
        var delivery = order.Delivery!;
        if (delivery.DriverId != driverId) throw new WorkflowException("This order is assigned to another driver.");

        var otp = Otp.Generate();
        delivery.OtpHash = Otp.Hash(otp, delivery.Id);
        delivery.StartedAt = DateTime.UtcNow;
        order.Status = OrderStatus.OutForDelivery;
        await db.SaveChangesAsync();

        var phone = await db.Customers.Where(c => c.Id == order.CustomerId).Select(c => c.User.Phone).FirstAsync();
        await otpSender.SendAsync(phone, otp, order.OrderNo);
        return order;
    }

    public async Task<Delivery> RecordLocationAsync(int orderId, int driverId, double lat, double lng)
    {
        var order = await Get(orderId);
        Require(order, OrderStatus.OutForDelivery);
        var d = order.Delivery!;
        if (d.DriverId != driverId) throw new WorkflowException("This order is assigned to another driver.");
        d.LastLat = lat; d.LastLng = lng; d.LastLocationAt = DateTime.UtcNow;
        db.LocationPings.Add(new LocationPing { DeliveryId = d.Id, Lat = lat, Lng = lng });
        await db.SaveChangesAsync();
        return d;
    }

    /// <summary>OTP check, full/empty can counts, cash, stock, invoice and payment in one step.</summary>
    public async Task<Order> CompleteDeliveryAsync(int orderId, int driverId, CompleteDeliveryRequest req)
    {
        var order = await Get(orderId);
        Require(order, OrderStatus.OutForDelivery);
        var d = order.Delivery!;
        if (d.DriverId != driverId) throw new WorkflowException("This order is assigned to another driver.");
        if (!Otp.Verify(req.Otp, d.Id, d.OtpHash)) throw new WorkflowException("Wrong OTP.");
        if (req.FullCansDelivered < 0 || req.EmptyCansCollected < 0 || req.CashCollected < 0)
            throw new WorkflowException("Counts and cash cannot be negative.");

        var customer = await db.Customers.FirstAsync(c => c.Id == order.CustomerId);
        var now = DateTime.UtcNow;

        d.OtpVerifiedAt = now;
        d.DeliveredAt = now;
        d.FullCansDelivered = req.FullCansDelivered;
        d.EmptyCansCollected = req.EmptyCansCollected;
        d.CashCollected = req.CashCollected;
        order.Status = OrderStatus.Delivered;

        // Cans and stock
        customer.CansHeld += req.FullCansDelivered - req.EmptyCansCollected;
        db.CanLedger.Add(new CanLedgerEntry { CustomerId = customer.Id, OrderId = order.Id, Out = req.FullCansDelivered, In = req.EmptyCansCollected, BalanceAfter = customer.CansHeld });
        foreach (var item in order.Items)
        {
            item.Product.StockFull -= item.Qty;
            db.StockMovements.Add(new StockMovement { ProductId = item.ProductId, Qty = item.Qty, Type = StockMovementType.Out, OrderId = order.Id });
        }
        var returnable = order.Items.FirstOrDefault(i => i.Product.IsReturnable);
        if (returnable is not null && req.EmptyCansCollected > 0)
            db.StockMovements.Add(new StockMovement { ProductId = returnable.ProductId, Qty = req.EmptyCansCollected, Type = StockMovementType.Returned, OrderId = order.Id });

        // Money: paid online already, cash now, or added to the customer's dues
        var paidBefore = await db.Payments.Where(p => p.OrderId == order.Id).SumAsync(p => (decimal?)p.Amount) ?? 0m;
        if (req.CashCollected > 0)
            db.Payments.Add(new Payment { CustomerId = customer.Id, OrderId = order.Id, Amount = req.CashCollected, Mode = PaymentMode.Cash, Reference = "Driver" });
        var paid = paidBefore + req.CashCollected;
        customer.Balance += order.Total - paid;

        order.Invoice = new Invoice
        {
            InvoiceNo = "INV-" + order.OrderNo,
            OrderId = order.Id,
            CustomerId = customer.Id,
            Amount = order.Total,
            AmountPaid = paid,
            Status = paid >= order.Total ? InvoiceStatus.Paid : paid > 0 ? InvoiceStatus.PartiallyPaid : InvoiceStatus.Unpaid
        };
        order.Status = OrderStatus.Completed;
        await db.SaveChangesAsync();
        return order;
    }

    public async Task<Order> CancelAsync(int orderId)
    {
        var order = await Get(orderId);
        if (order.Status is OrderStatus.OutForDelivery or OrderStatus.Delivered or OrderStatus.Completed)
            throw new WorkflowException($"Cannot cancel an order that is {order.Status}.");
        order.Status = OrderStatus.Cancelled;
        await db.SaveChangesAsync();
        return order;
    }

    /// <summary>Customer pays off dues (e.g. monthly credit settlement).</summary>
    public async Task<Customer> SettleDuesAsync(int customerId, decimal amount, PaymentMode mode, string? reference)
    {
        if (amount <= 0) throw new WorkflowException("Amount must be positive.");
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Id == customerId) ?? throw new WorkflowException("Customer not found.");
        db.Payments.Add(new Payment { CustomerId = customerId, Amount = amount, Mode = mode, Reference = reference });
        customer.Balance -= amount;
        await db.SaveChangesAsync();
        return customer;
    }

    private async Task<Order> Get(int id) =>
        await db.Orders.Include(o => o.Items).ThenInclude(i => i.Product).Include(o => o.Delivery).Include(o => o.Invoice)
            .FirstOrDefaultAsync(o => o.Id == id) ?? throw new WorkflowException("Order not found.");

    private static void Require(Order o, params OrderStatus[] allowed)
    {
        if (!allowed.Contains(o.Status))
            throw new WorkflowException($"Order {o.OrderNo} is {o.Status}; expected {string.Join(" or ", allowed)}.");
    }
}
