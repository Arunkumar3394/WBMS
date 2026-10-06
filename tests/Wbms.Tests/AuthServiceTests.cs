using Microsoft.EntityFrameworkCore;
using Wbms.Core.Entities;
using Wbms.Core.Services;
using Wbms.Data;
using Wbms.Data.Services;

namespace Wbms.Tests;

public class AuthServiceTests
{
    private class Inbox : IOtpSender
    {
        public string? Last;
        public Task SendAsync(string phone, string otp, string orderNo) { Last = otp; return Task.CompletedTask; }
    }

    private static (WbmsDbContext db, AuthService auth, Inbox sms) Setup()
    {
        var db = new WbmsDbContext(new DbContextOptionsBuilder<WbmsDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        SeedData.Ensure(db);
        var sms = new Inbox();
        return (db, new AuthService(db, sms), sms);
    }

    [Fact]
    public async Task Otp_login_returns_driver_identity_and_code_works_once()
    {
        var (_, auth, sms) = Setup();
        await auth.RequestLoginOtpAsync("+91 90000 00001");
        var user = await auth.VerifyLoginOtpAsync("9000000001", sms.Last!);
        Assert.Equal(UserRole.Driver, user.Role);
        Assert.NotNull(user.DriverId);
        await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyLoginOtpAsync("9000000001", sms.Last!));
    }

    [Fact]
    public async Task Code_locks_after_too_many_wrong_attempts()
    {
        var (_, auth, sms) = Setup();
        await auth.RequestLoginOtpAsync("9000000002");
        var wrong = sms.Last == "0000" ? "1111" : "0000";
        for (var i = 0; i < AuthService.MaxAttempts; i++)
            await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyLoginOtpAsync("9000000002", wrong));
        var ex = await Assert.ThrowsAsync<WorkflowException>(() => auth.VerifyLoginOtpAsync("9000000002", sms.Last!));
        Assert.Contains("Too many", ex.Message);
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
        var u = await auth.VerifyLoginOtpAsync("9876543210", sms.Last!);
        Assert.NotNull(u.CustomerId);
        await Assert.ThrowsAsync<WorkflowException>(() =>
            auth.RegisterCustomerAsync(new RegisterCustomerRequest("Again", "9876543210", CustomerType.Home, "x", "y", null, null)));
    }
}
