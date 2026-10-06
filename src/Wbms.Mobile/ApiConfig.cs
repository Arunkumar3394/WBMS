namespace Wbms.Mobile;

public static class ApiConfig
{
    /// <summary>
    /// Where the WBMS API runs. 10.0.2.2 is your PC as seen from the Android emulator (API "http" profile, port 5196).
    /// On a real phone use your PC's Wi-Fi IP (e.g. http://192.168.1.10:5196/) and start the API with
    /// --urls http://0.0.0.0:5196. In production use the https address of the hosted API.
    /// </summary>
    public const string BaseUrl = "http://10.0.2.2:5196/";
}
