using CommunityToolkit.Mvvm.ComponentModel;

namespace Wbms.Client.ViewModels;

public abstract partial class BaseViewModel : ObservableObject
{
    [ObservableProperty] private bool busy;
    [ObservableProperty] private string? error;

    /// <summary>Runs an action with the busy flag set, turning API errors into a message for the screen.</summary>
    protected async Task<bool> Run(Func<Task> action)
    {
        if (Busy) return false;
        Busy = true;
        Error = null;
        try { await action(); return true; }
        catch (ApiException ex) { Error = ex.Message; return false; }
        finally { Busy = false; }
    }
}
