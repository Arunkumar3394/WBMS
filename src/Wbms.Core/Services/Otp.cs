using System.Security.Cryptography;
using System.Text;

namespace Wbms.Core.Services;

public static class Otp
{
    public static string Generate() => RandomNumberGenerator.GetInt32(0, 10000).ToString("D4");

    public static string Hash(string otp, int deliveryId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{deliveryId}:{otp}")));

    public static bool Verify(string otp, int deliveryId, string? hash) =>
        hash is not null && CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(Hash(otp, deliveryId)), Encoding.UTF8.GetBytes(hash));
}

public class WorkflowException(string message) : Exception(message);

/// <summary>Sends the delivery OTP to the customer. Replace the console sender with an SMS provider.</summary>
public interface IOtpSender
{
    Task SendAsync(string phone, string otp, string orderNo);
}

public class ConsoleOtpSender : IOtpSender
{
    public Task SendAsync(string phone, string otp, string orderNo)
    {
        Console.WriteLine($"[OTP] {phone}: your WBMS delivery code for {orderNo} is {otp}");
        return Task.CompletedTask;
    }
}
