using Microsoft.EntityFrameworkCore;
using Wbms.Core.Entities;
using Wbms.Core.Services;
using Wbms.Data;
using Wbms.Data.Services;

namespace Wbms.Tests;

public class OrderServiceTests
{
    private class CapturingSender : IOtpSender
    {
        public string? LastOtp;
        public Task SendAsync(string phone, string otp, string orderNo) { LastOtp = otp; return Task.CompletedTask; }
    }

    private static (WbmsDbContext db, OrderService svc, CapturingSender sms) Setup()
    {
        var db = new WbmsDbContext(new DbContextOptionsBuilder<WbmsDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        SeedData.Ensure(db);
        var sms = new CapturingSender();
        return (db, new OrderService(db, sms), sms);
    }

    private static BookOrderRequest Booking(WbmsDbContext db, PaymentMode mode, int qty = 5)
    {
        var c = db.Customers.Include(x => x.Addresses).First();
        var can = db.Products.First(p => p.IsReturnable);
        return new BookOrderRequest(c.Id, c.Addresses[0].Id, mode, DateOnly.FromDateTime(DateTime.Today), [new OrderLine(can.Id, qty)], null);
    }

    [Fact]
    public async Task Full_flow_on_credit_updates_cans_dues_stock_and_invoice()
    {
        var (db, svc, sms) = Setup();
        var driver = db.Drivers.First();

        var order = await svc.BookAsync(Booking(db, PaymentMode.Credit));
        Assert.Equal(OrderStatus.OnCredit, order.Status);
        Assert.Equal(200m, order.Total);

        await svc.ConfirmAsync(order.Id);
        await svc.AssignAsync(order.Id, driver.Id);
        await svc.StartDeliveryAsync(order.Id, driver.Id);
        Assert.NotNull(sms.LastOtp);
        await svc.RecordLocationAsync(order.Id, driver.Id, 13.08, 80.27);

        order = await svc.CompleteDeliveryAsync(order.Id, driver.Id, new CompleteDeliveryRequest(sms.LastOtp!, 5, 3, 0));

        var customer = db.Customers.First();
        Assert.Equal(OrderStatus.Completed, order.Status);
        Assert.Equal(2, customer.CansHeld);
        Assert.Equal(200m, customer.Balance);
        Assert.Equal(195, db.Products.First(p => p.IsReturnable).StockFull);
        Assert.Equal(InvoiceStatus.Unpaid, order.Invoice!.Status);
    }

    [Fact]
    public async Task Cash_collected_by_driver_marks_invoice_paid()
    {
        var (db, svc, sms) = Setup();
        var driver = db.Drivers.First();
        var order = await svc.BookAsync(Booking(db, PaymentMode.Cash, 2));
        await svc.ConfirmAsync(order.Id);
        await svc.AssignAsync(order.Id, driver.Id);
        await svc.StartDeliveryAsync(order.Id, driver.Id);
        order = await svc.CompleteDeliveryAsync(order.Id, driver.Id, new CompleteDeliveryRequest(sms.LastOtp!, 2, 2, 80));

        Assert.Equal(InvoiceStatus.Paid, order.Invoice!.Status);
        Assert.Equal(0m, db.Customers.First().Balance);
    }

    [Fact]
    public async Task Online_payment_must_be_recorded_before_confirmation()
    {
        var (db, svc, _) = Setup();
        var order = await svc.BookAsync(Booking(db, PaymentMode.Razorpay));
        Assert.Equal(OrderStatus.PaymentPending, order.Status);
        await Assert.ThrowsAsync<WorkflowException>(() => svc.ConfirmAsync(order.Id));

        await svc.RecordOnlinePaymentAsync(order.Id, order.Total, "pay_test123");
        order = await svc.ConfirmAsync(order.Id);
        Assert.Equal(OrderStatus.Confirmed, order.Status);
    }

    [Fact]
    public async Task Wrong_otp_is_rejected()
    {
        var (db, svc, sms) = Setup();
        var driver = db.Drivers.First();
        var order = await svc.BookAsync(Booking(db, PaymentMode.Cash));
        await svc.ConfirmAsync(order.Id);
        await svc.AssignAsync(order.Id, driver.Id);
        await svc.StartDeliveryAsync(order.Id, driver.Id);
        var wrong = sms.LastOtp == "0000" ? "1111" : "0000";

        await Assert.ThrowsAsync<WorkflowException>(() =>
            svc.CompleteDeliveryAsync(order.Id, driver.Id, new CompleteDeliveryRequest(wrong, 5, 0, 0)));
    }

    [Fact]
    public async Task Credit_limit_is_enforced()
    {
        var (db, svc, _) = Setup();
        await Assert.ThrowsAsync<WorkflowException>(() => svc.BookAsync(Booking(db, PaymentMode.Credit, qty: 30)));
    }

    [Fact]
    public async Task Cannot_skip_confirmation()
    {
        var (db, svc, _) = Setup();
        var order = await svc.BookAsync(Booking(db, PaymentMode.Cash));
        await Assert.ThrowsAsync<WorkflowException>(() => svc.AssignAsync(order.Id, db.Drivers.First().Id));
    }
}
