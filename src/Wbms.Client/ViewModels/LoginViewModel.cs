using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace Wbms.Client.ViewModels;

/// <summary>Phone + SMS code sign-in for customers and drivers, plus customer sign-up.</summary>
public partial class LoginViewModel(WbmsApi api, ISessionStore sessions) : BaseViewModel
{
    [ObservableProperty] private string phone = "";
    [ObservableProperty] private string code = "";
    [ObservableProperty] private bool codeSent;

    // Sign-up fields
    [ObservableProperty] private bool registering;
    [ObservableProperty] private string name = "";
    [ObservableProperty] private string addressLine = "";
    [ObservableProperty] private string area = "";

    /// <summary>Raised after a successful sign-in so the app can open the customer or driver screens.</summary>
    public event Action<SignedInUser>? SignedIn;

    /// <summary>Restores a saved session on app start. Returns the user if still signed in.</summary>
    public async Task<SignedInUser?> RestoreAsync()
    {
        var s = await sessions.LoadAsync();
        if (s is null) return null;
        api.UseToken(s.Token);
        try { await api.MeAsync(); return s.User; }
        catch (ApiException ex) when (ex.Status == System.Net.HttpStatusCode.Unauthorized)
        {
            await sessions.ClearAsync();
            api.UseToken(null);
            return null;
        }
        catch (ApiException) { return s.User; } // offline: keep the session
    }

    [RelayCommand]
    private Task SendCode() => Run(async () =>
    {
        if (Registering)
        {
            if (string.IsNullOrWhiteSpace(Name) || string.IsNullOrWhiteSpace(AddressLine))
                throw new ApiException("Please enter your name and address.", 0);
            await api.RegisterAsync(new RegisterRequest(Name.Trim(), Phone, CustomerType.Home, AddressLine.Trim(), Area.Trim(), null, null));
            Registering = false;
        }
        await api.RequestOtpAsync(Phone);
        CodeSent = true;
    });

    [RelayCommand]
    private Task Verify() => Run(async () =>
    {
        var session = await api.VerifyAsync(Phone, Code.Trim());
        if (session.User.Role is not (UserRole.Customer or UserRole.Driver))
            throw new ApiException("Staff please use the admin website.", 0);
        api.UseToken(session.Token);
        await sessions.SaveAsync(session);
        Code = "";
        CodeSent = false;
        SignedIn?.Invoke(session.User);
    });

    [RelayCommand]
    private void ChangeNumber() { CodeSent = false; Code = ""; }

    [RelayCommand]
    private void ToggleRegister() => Registering = !Registering;

    public async Task SignOutAsync()
    {
        await sessions.ClearAsync();
        api.UseToken(null);
    }
}
