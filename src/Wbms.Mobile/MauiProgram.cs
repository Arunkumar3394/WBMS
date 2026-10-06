using Wbms.Client;
using Wbms.Client.ViewModels;
using Wbms.Mobile.Pages;
using Wbms.Mobile.Services;

namespace Wbms.Mobile;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder.UseMauiApp<App>();

        builder.Services.AddSingleton(new WbmsApi(new HttpClient { BaseAddress = new Uri(ApiConfig.BaseUrl), Timeout = TimeSpan.FromSeconds(20) }));
        builder.Services.AddSingleton<ISessionStore, SecureSessionStore>();
        builder.Services.AddSingleton<ILocationProvider, DeviceLocationProvider>();

        builder.Services.AddSingleton<LoginViewModel>();
        builder.Services.AddTransient<DriverOrdersViewModel>();
        builder.Services.AddTransient<DeliveryViewModel>();
        builder.Services.AddTransient<CustomerViewModel>();
        builder.Services.AddTransient(sp => new TrackingViewModel(sp.GetRequiredService<WbmsApi>()));

        builder.Services.AddSingleton<LoginPage>();
        builder.Services.AddTransient<DriverOrdersPage>();
        builder.Services.AddTransient<DeliveryPage>();
        builder.Services.AddTransient<CustomerHomePage>();
        builder.Services.AddTransient<TrackingPage>();

        return builder.Build();
    }
}
