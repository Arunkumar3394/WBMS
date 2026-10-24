using System;
using System.Collections.Generic;
using System.Data.Entity;
using System.Linq;
using System.Threading.Tasks;
using Wbms.Api47.Data;
using Wbms.Api47.Entities;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;
using Xunit;

namespace Wbms.Api47.Tests;

public class AuthServiceTests
{
    private static (WbmsDb db, AuthService auth, SmsInbox sms) Setup()
    {
        var db = TestDb.Create();
        var sms = new SmsInbox();
        return (db, new AuthService(db, sms), sms);
    }

    [Fact]
    public async Task Otp_login_returns_driver_identity_and_code_works_once()
    {
        var (_, auth, sms) = Setup();
        await auth.RequestLoginOtpAsync("+91 90000 00001");
        var user = await auth.VerifyLoginOtpAsync("9000000001", sms.Last["9000000001"]);
        Assert.Equal(UserRole.Driver, user.Role);
        Assert.NotNull(user.DriverId);
        await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyLoginOtpAsync("9000000001", sms.Last["9000000001"]));
    }

    [Fact]
    public async Task Code_locks_after_too_many_wrong_attempts()
    {
        var (_, auth, sms) = Setup();
        await auth.RequestLoginOtpAsync("9000000002");
        var code = sms.Last["9000000002"];
        var wrong = code == "0000" ? "1111" : "0000";
        for (var i = 0; i < AuthService.MaxAttempts; i++)
            await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyLoginOtpAsync("9000000002", wrong));
        var ex = await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyLoginOtpAsync("9000000002", code));
        Assert.Contains("Too many", ex.Message);
    }

    [Fact]
    public async Task Second_code_within_30_seconds_is_refused()
    {
        var (_, auth, _) = Setup();
        await auth.RequestLoginOtpAsync("9000000002");
        await Assert.ThrowsAsync<WorkflowException>(() => auth.RequestLoginOtpAsync("9000000002"));
    }

    [Fact]
    public async Task Unknown_phone_cannot_request_code()
    {
        var (_, auth, _) = Setup();
        await Assert.ThrowsAsync<WorkflowException>(() => auth.RequestLoginOtpAsync("9999999999"));
    }

    [Fact]
    public async Task Admin_password_login_and_drivers_cannot_use_passwords()
    {
        var (_, auth, _) = Setup();
        var admin = await auth.VerifyPasswordAsync("9000000000", SeedData.DemoAdminPassword);
        Assert.Equal(UserRole.Admin, admin.Role);
        await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyPasswordAsync("9000000000", "wrong-password"));
        await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyPasswordAsync("9000000001", SeedData.DemoAdminPassword));
    }

    [Fact]
    public async Task Customer_can_register_then_log_in()
    {
        var (_, auth, sms) = Setup();
        await auth.RegisterCustomerAsync(new RegisterCustomerRequest("Meena", "98765 43210", CustomerType.Home, "5, Lake View", "Adyar", null, null));
        await auth.RequestLoginOtpAsync("9876543210");
        var u = await auth.VerifyLoginOtpAsync("9876543210", sms.Last["9876543210"]);
        Assert.NotNull(u.CustomerId);
        await Assert.ThrowsAsync<WorkflowException>(() =>
            auth.RegisterCustomerAsync(new RegisterCustomerRequest("Again", "9876543210", CustomerType.Home, "x", "y", null, null)));
    }

    [Fact]
    public void Password_hash_round_trips_and_is_salted()
    {
        var a = PasswordHasher.Hash("secret-123");
        Assert.True(PasswordHasher.Verify(a, "secret-123"));
        Assert.False(PasswordHasher.Verify(a, "secret-124"));
        Assert.NotEqual(a, PasswordHasher.Hash("secret-123"));
        Assert.False(PasswordHasher.Verify(null, "x"));
    }
}

public class OrderServiceTests
{
    private static (WbmsDb db, OrderService svc, SmsInbox sms) Setup()
    {
        var db = TestDb.Create();
        var sms = new SmsInbox();
        return (db, new OrderService(db, sms), sms);
    }

    private static BookOrderRequest Booking(WbmsDb db, PaymentMode mode, int qty = 5)
    {
        var c = db.Customers.Include(x => x.Addresses).First();
        var can = db.Products.First(p => p.IsReturnable);
        return new BookOrderRequest(c.Id, c.Addresses[0].Id, mode, DateTime.Today, new List<OrderLine> { new OrderLine(can.Id, qty) }, null);
    }

    private static string LastCode(SmsInbox sms) => sms.Codes[sms.Codes.Count - 1];

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
        await svc.RecordLocationAsync(order.Id, driver.Id, 13.08, 80.27);

        order = await svc.CompleteDeliveryAsync(order.Id, driver.Id, new CompleteDeliveryRequest(LastCode(sms), 5, 3, 0));

        var customer = db.Customers.First();
        Assert.Equal(OrderStatus.Completed, order.Status);
        Assert.Equal(2, customer.CansHeld);
        Assert.Equal(200m, customer.Balance);
        Assert.Equal(195, db.Products.First(p => p.IsReturnable).StockFull);
        var invoice = db.Invoices.Single(i => i.OrderId == order.Id);
        Assert.Equal(InvoiceStatus.Unpaid, invoice.Status);
        Assert.Equal("INV-" + order.OrderNo, invoice.InvoiceNo);
        Assert.Equal(1, db.LocationPings.Count(p => p.OrderId == order.Id));
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
        order = await svc.CompleteDeliveryAsync(order.Id, driver.Id, new CompleteDeliveryRequest(LastCode(sms), 2, 2, 80));

        Assert.Equal(InvoiceStatus.Paid, db.Invoices.Single(i => i.OrderId == order.Id).Status);
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
        var wrong = LastCode(sms) == "0000" ? "1111" : "0000";

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

    [Fact]
    public async Task Resent_code_replaces_the_old_one()
    {
        var (db, svc, sms) = Setup();
        var driver = db.Drivers.First();
        var order = await svc.BookAsync(Booking(db, PaymentMode.Cash, 1));
        await svc.ConfirmAsync(order.Id);
        await svc.AssignAsync(order.Id, driver.Id);
        await svc.StartDeliveryAsync(order.Id, driver.Id);
        var first = LastCode(sms);
        string second;
        do { await svc.ResendDeliveryOtpAsync(order.Id, driver.Id); second = LastCode(sms); } while (second == first);

        await Assert.ThrowsAsync<WorkflowException>(() => svc.CompleteDeliveryAsync(order.Id, driver.Id, new CompleteDeliveryRequest(first, 1, 0, 40)));
        order = await svc.CompleteDeliveryAsync(order.Id, driver.Id, new CompleteDeliveryRequest(second, 1, 0, 40));
        Assert.Equal(OrderStatus.Completed, order.Status);
    }

    [Fact]
    public async Task Settling_dues_reduces_balance()
    {
        var (db, svc, _) = Setup();
        var c = db.Customers.First();
        c.Balance = 500;
        db.SaveChanges();
        var after = await svc.SettleDuesAsync(c.Id, 200, PaymentMode.Cash, "Office");
        Assert.Equal(300m, after.Balance);
        await Assert.ThrowsAsync<WorkflowException>(() => svc.SettleDuesAsync(c.Id, 0, PaymentMode.Cash, null));
    }
}

public class OtpTests
{
    [Fact]
    public void Codes_are_four_digits_and_bound_to_their_context()
    {
        var code = Otp.Generate();
        Assert.Matches("^[0-9]{4}$", code);
        var hash = Otp.Hash(code, "delivery:1");
        Assert.True(Otp.Verify(code, "delivery:1", hash));
        Assert.False(Otp.Verify(code, "delivery:2", hash));
        Assert.False(Otp.Verify(code, "delivery:1", null));
    }

    [Fact]
    public void Phone_numbers_are_normalized()
    {
        Assert.Equal("9876543210", AuthService.Normalize("+91 98765-43210"));
        Assert.Equal("9876543210", AuthService.Normalize("9876543210"));
    }
}

public class FirstAdminTests
{
    [Fact]
    public async Task Live_server_gets_its_first_admin_once_from_settings()
    {
        var db = new WbmsDb(Effort.DbConnectionFactory.CreateTransient(), true);
        SeedData.EnsureFirstAdmin(db, "", "");
        Assert.False(db.Users.Any());

        SeedData.EnsureFirstAdmin(db, "9123456789", "Owner@2026");
        var user = await new AuthService(db, new SmsInbox()).VerifyPasswordAsync("9123456789", "Owner@2026");
        Assert.Equal(UserRole.Admin, user.Role);

        // Later starts leave the existing admin alone, even with other values.
        SeedData.EnsureFirstAdmin(db, "9111111111", "Another@2026");
        Assert.Single(db.Users);
    }

    [Fact]
    public void Short_password_is_refused()
    {
        var db = new WbmsDb(Effort.DbConnectionFactory.CreateTransient(), true);
        Assert.Throws<InvalidOperationException>(() => SeedData.EnsureFirstAdmin(db, "9123456789", "short"));
    }
}
