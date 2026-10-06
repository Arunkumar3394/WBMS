using System.Globalization;
using Wbms.Client;
using Wbms.Client.ViewModels;
using Wbms.Mobile.Pages;

namespace Wbms.Mobile;

public partial class App : Application
{
    private readonly IServiceProvider services;

    public App(IServiceProvider services, LoginViewModel login)
    {
        InitializeComponent();
        this.services = services;
        login.SignedIn += user => MainThread.BeginInvokeOnMainThread(() => ShowHome(user));
        MainPage = new ContentPage { Content = new ActivityIndicator { IsRunning = true, VerticalOptions = LayoutOptions.Center } };
        _ = Startup(login);
    }

    private async Task Startup(LoginViewModel login)
    {
        var user = await login.RestoreAsync();
        if (user is null) ShowLogin();
        else ShowHome(user);
    }

    public void ShowLogin() => MainPage = new NavigationPage(services.GetRequiredService<LoginPage>());

    private void ShowHome(SignedInUser user) => MainPage = new NavigationPage(user.Role == UserRole.Driver
        ? services.GetRequiredService<DriverOrdersPage>()
        : services.GetRequiredService<CustomerHomePage>());

    public static async Task SignOut()
    {
        var app = (App)Current!;
        await app.services.GetRequiredService<LoginViewModel>().SignOutAsync();
        app.ShowLogin();
    }

    public static T Resolve<T>() where T : notnull => ((App)Current!).services.GetRequiredService<T>();
}

public class InverseBoolConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value is not true;
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => value is not true;
}

public class NotNullConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value is not null && value is not "";
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
