using System;
using System.Configuration;
using System.Globalization;

namespace Wbms.Api47.Infrastructure;

/// <summary>
/// Settings from App.config &lt;appSettings&gt;, e.g. key "Jwt:Key". An environment variable with ":" written as "__"
/// (Jwt__Key) wins, so secrets can stay out of the config file.
/// </summary>
public static class AppConfig
{
    public static string Get(string key, string fallback = "")
    {
        var env = Environment.GetEnvironmentVariable(key.Replace(":", "__"));
        if (!string.IsNullOrEmpty(env)) return env!;
        var value = ConfigurationManager.AppSettings[key];
        return string.IsNullOrEmpty(value) ? fallback : value!;
    }

    public static int GetInt(string key, int fallback) =>
        int.TryParse(Get(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : fallback;

    public static bool GetBool(string key, bool fallback) =>
        bool.TryParse(Get(key), out var v) ? v : fallback;
}
