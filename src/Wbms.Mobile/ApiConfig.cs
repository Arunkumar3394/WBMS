namespace Wbms.Mobile;

public static class ApiConfig
{
    /// <summary>
    /// Where the WBMS API (Wbms.Api47) runs. 10.0.2.2 is your PC as seen from the Android emulator.
    /// The API must listen on all addresses for this: set Web:Url to http://+:5080/ in its App.config and allow it once
    /// (README, "Mobile app"). On a real phone use your PC's Wi-Fi IP (e.g. http://192.168.1.10:5080/).
    /// In production use the https address of the hosted API.
    /// </summary>
    public const string BaseUrl = "http://10.0.2.2:5080/";
}
