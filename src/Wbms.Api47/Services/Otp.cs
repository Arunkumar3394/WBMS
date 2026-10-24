using System;
using System.Security.Cryptography;
using System.Text;

namespace Wbms.Api47.Services;

public static class Otp
{
    /// <summary>A random 4-digit code.</summary>
    public static string Generate()
    {
        var bytes = new byte[4];
        using var rng = RandomNumberGenerator.Create();
        uint value;
        do { rng.GetBytes(bytes); value = BitConverter.ToUInt32(bytes, 0); }
        while (value >= uint.MaxValue - uint.MaxValue % 10000); // no modulo bias
        return (value % 10000).ToString("D4");
    }

    /// <summary>Hashes a code bound to its context (a delivery or a phone number) so a code can't be reused elsewhere.</summary>
    public static string Hash(string otp, string context)
    {
        using var sha = SHA256.Create();
        var hash = sha.ComputeHash(Encoding.UTF8.GetBytes($"{context}:{otp}"));
        return BitConverter.ToString(hash).Replace("-", "");
    }

    public static bool Verify(string otp, string context, string? hash) =>
        hash != null && FixedTimeEquals(Encoding.UTF8.GetBytes(Hash(otp ?? "", context)), Encoding.UTF8.GetBytes(hash));

    public static bool FixedTimeEquals(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        var diff = 0;
        for (var i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}
