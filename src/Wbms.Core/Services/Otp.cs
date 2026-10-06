using System.Security.Cryptography;
using System.Text;

namespace Wbms.Core.Services;

public static class Otp
{
    public static string Generate() => RandomNumberGenerator.GetInt32(0, 10000).ToString("D4");

    /// <summary>Hashes a code bound to its context (a delivery id or a phone number) so a code can't be reused elsewhere.</summary>
    public static string Hash(string otp, string context) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{context}:{otp}")));

    public static bool Verify(string otp, string context, string? hash) =>
        hash is not null && CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(Hash(otp, context)), Encoding.UTF8.GetBytes(hash));
}

public class WorkflowException(string message) : Exception(message);

public enum OtpPurpose { Login, Delivery }

/// <summary>Texts a one-time code. ConsoleOtpSender prints it (development); Msg91OtpSender sends a real SMS.</summary>
public interface IOtpSender
{
    /// <param name="orderNo">The order the code is for; null for login codes.</param>
    Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null);
}

public class ConsoleOtpSender : IOtpSender
{
    public Task SendAsync(string phone, string otp, OtpPurpose purpose, string? orderNo = null)
    {
        Console.WriteLine(purpose == OtpPurpose.Login
            ? $"[OTP] {phone}: your WBMS login code is {otp}"
            : $"[OTP] {phone}: your WBMS delivery code for {orderNo} is {otp}");
        return Task.CompletedTask;
    }
}
