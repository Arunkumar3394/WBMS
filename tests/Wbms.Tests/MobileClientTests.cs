using Microsoft.AspNetCore.Http.Connections;
using Wbms.Client;
using Wbms.Client.ViewModels;

namespace Wbms.Tests;

/// <summary>Drives the mobile app's view models against the real API (in memory).</summary>
public class MobileClientTests : IDisposable
{
    private readonly ApiTests.Factory factory = new();
    public void Dispose() => factory.Dispose();

    private class FixedLocation(GeoPoint p) : ILocationProvider
    {
        public Task<GeoPoint?> GetAsync(CancellationToken ct) => Task.FromResult<GeoPoint?>(p);
    }

    private WbmsApi NewApi() => new(factory.CreateClient());

    private async Task<(WbmsApi api, SignedInUser user)> SignIn(string phone)
    {
        var api = NewApi();
        var login = new LoginViewModel(api, new MemorySessionStore());
        SignedInUser? user = null;
        login.SignedIn += u => user = u;
        login.Phone = phone;
        await login.SendCodeCommand.ExecuteAsync(null);
        Assert.True(login.CodeSent, login.Error);
        login.Code = factory.Sms.Last[phone];
        await login.VerifyCommand.ExecuteAsync(null);
        Assert.NotNull(user);
        return (api, user!);
    }

    [Fact]
    public async Task Customer_books_driver_delivers_and_customer_sees_live_location()
    {
        var (customerApi, customer) = await SignIn("9000000002");
        Assert.Equal(UserRole.Customer, customer.Role);

        var home = new CustomerViewModel(customerApi);
        await home.Load();
        home.Quantity = 4;
        await home.BookCommand.ExecuteAsync(null);
        Assert.Null(home.Error);
        var order = Assert.Single(home.Orders);

        // Office confirms and assigns (staff token through the API)
        var staff = NewApi();
        await staff.RequestOtpAsync("9000000000");
        staff.UseToken((await staff.VerifyAsync("9000000000", factory.Sms.Last["9000000000"])).Token);
        using (var http = factory.CreateClient())
        {
            http.DefaultRequestHeaders.Authorization = new("Bearer", staff.Token);
            (await http.PostAsync($"api/orders/{order.Id}/confirm", null)).EnsureSuccessStatusCode();
            (await http.PostAsync($"api/orders/{order.Id}/assign", System.Net.Http.Json.JsonContent.Create(new { driverId = 1 }))).EnsureSuccessStatusCode();
        }

        // Customer opens live tracking
        var server = factory.Server;
        await using var tracking = new TrackingViewModel(customerApi, o =>
        {
            o.HttpMessageHandlerFactory = _ => server.CreateHandler();
            o.Transports = HttpTransportType.LongPolling;
        });
        await tracking.StartAsync(order.Id);
        Assert.Null(tracking.Error);

        // Driver
        var (driverApi, driver) = await SignIn("9000000001");
        var list = new DriverOrdersViewModel(driverApi);
        await list.Load();
        var assigned = Assert.Single(list.Orders);

        var delivery = new DeliveryViewModel(driverApi, new FixedLocation(new GeoPoint(13.0827, 80.2707)));
        delivery.Load(assigned);
        Assert.True(delivery.CanStart);
        Assert.Equal(4, delivery.FullCansDelivered);
        Assert.Equal(160m, delivery.CashCollected);

        await delivery.StartCommand.ExecuteAsync(null);
        delivery.StopTracking(); // drive the location updates by hand in the test
        Assert.True(delivery.CanComplete);
        Assert.True(await delivery.SendLocationOnceAsync(assigned.Id, default));

        for (var i = 0; i < 50 && tracking.DriverLocation is null; i++) await Task.Delay(100);
        Assert.Equal(13.0827, tracking.DriverLocation?.Lat);

        delivery.Otp = factory.Sms.Last["9000000002"];
        delivery.EmptyCansCollected = 3;
        await delivery.CompleteCommand.ExecuteAsync(null);
        Assert.Null(delivery.Error);
        Assert.True(delivery.IsDone);

        await home.Load();
        Assert.Equal(1, home.Profile!.CansHeld);
        Assert.Single(home.Invoices);
    }

    [Fact]
    public async Task New_customer_can_sign_up_in_the_app()
    {
        var api = NewApi();
        var login = new LoginViewModel(api, new MemorySessionStore());
        login.ToggleRegisterCommand.Execute(null);
        login.Name = "Meena";
        login.Phone = "9876543210";
        login.AddressLine = "5, Lake View";
        login.Area = "Adyar";
        await login.SendCodeCommand.ExecuteAsync(null);
        Assert.True(login.CodeSent, login.Error);
    }

    [Fact]
    public async Task Wrong_delivery_code_shows_an_error_and_keeps_the_delivery_open()
    {
        var (driverApi, _) = await SignIn("9000000001");
        var vm = new DeliveryViewModel(driverApi, new FixedLocation(new GeoPoint(0, 0)));
        vm.Load(new Order(999, "X", 1, "", "", "addr", null, null, OrderStatus.OutForDelivery, PaymentMode.Cash, 0,
            DateOnly.FromDateTime(DateTime.Today), 1, null, [], null, null, null));
        vm.StopTracking();
        vm.Otp = "12";
        await vm.CompleteCommand.ExecuteAsync(null);
        Assert.Equal("Enter the 4-digit code from the customer.", vm.Error);
        vm.Otp = "1234";
        await vm.CompleteCommand.ExecuteAsync(null);
        Assert.NotNull(vm.Error); // order 999 doesn't exist: server message is shown
        Assert.True(vm.CanComplete);
    }
}
