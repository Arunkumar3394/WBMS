using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Wbms.Core.Entities;
using Wbms.Core.Services;

namespace Wbms.Data.Services;

/// <summary>Signed-in identity: who the user is and which customer/driver record they act as.</summary>
public record SignedInUser(int UserId, string Name, string Phone, UserRole Role, int? CustomerId, int? DriverId);

public record RegisterCustomerRequest(string Name, string Phone, CustomerType Type, string AddressLine, string Area, double? Lat, double? Lng);

public class AuthService(WbmsDbContext db, IOtpSender otpSender)
{
    public static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan ResendGap = TimeSpan.FromSeconds(30);
    public const int MaxAttempts = 5;
    private static readonly PasswordHasher<AppUser> Hasher = new();

    /// <summary>Texts a login code to a registered, active phone number.</summary>
    public async Task RequestLoginOtpAsync(string phone)
    {
        phone = Normalize(phone);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Phone == phone && u.IsActive)
            ?? throw new WorkflowException("This phone number is not registered.");
        var now = DateTime.UtcNow;
        if (await db.LoginOtps.AnyAsync(o => o.Phone == phone && o.CreatedAt > now - ResendGap))
            throw new WorkflowException("Please wait a few seconds before asking for another code.");

        var code = Otp.Generate();
        db.LoginOtps.Add(new LoginOtp { Phone = phone, CodeHash = Otp.Hash(code, $"login:{phone}"), CreatedAt = now, ExpiresAt = now + OtpLifetime });
        await db.SaveChangesAsync();
        await otpSender.SendAsync(user.Phone, code, "login");
    }

    public async Task<SignedInUser> VerifyLoginOtpAsync(string phone, string code)
    {
        phone = Normalize(phone);
        var now = DateTime.UtcNow;
        var otp = await db.LoginOtps.Where(o => o.Phone == phone && !o.Used && o.ExpiresAt > now)
            .OrderByDescending(o => o.CreatedAt).FirstOrDefaultAsync()
            ?? throw new WorkflowException("Code expired. Please request a new one.");
        if (otp.Attempts >= MaxAttempts) throw new WorkflowException("Too many wrong attempts. Please request a new code.");

        otp.Attempts++;
        if (!Otp.Verify(code, $"login:{phone}", otp.CodeHash))
        {
            await db.SaveChangesAsync();
            throw new WorkflowException("Wrong code.");
        }
        otp.Used = true;
        await db.SaveChangesAsync();
        return await LoadAsync(phone);
    }

    /// <summary>Password sign-in for the admin web (Admin and Staff only).</summary>
    public async Task<SignedInUser> VerifyPasswordAsync(string phone, string password)
    {
        phone = Normalize(phone);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Phone == phone && u.IsActive &&
            (u.Role == UserRole.Admin || u.Role == UserRole.Staff));
        if (user?.PasswordHash is null ||
            Hasher.VerifyHashedPassword(user, user.PasswordHash, password) == PasswordVerificationResult.Failed)
            throw new WorkflowException("Wrong phone number or password.");
        return await LoadAsync(phone);
    }

    public async Task SetPasswordAsync(int userId, string password)
    {
        if (password.Length < 8) throw new WorkflowException("Password must be at least 8 characters.");
        var user = await db.Users.FindAsync(userId) ?? throw new WorkflowException("User not found.");
        user.PasswordHash = Hasher.HashPassword(user, password);
        await db.SaveChangesAsync();
    }

    /// <summary>Self-sign-up from the customer app; the customer then logs in with an OTP.</summary>
    public async Task RegisterCustomerAsync(RegisterCustomerRequest r)
    {
        var phone = Normalize(r.Phone);
        if (string.IsNullOrWhiteSpace(r.Name) || string.IsNullOrWhiteSpace(r.AddressLine))
            throw new WorkflowException("Name and address are required.");
        if (await db.Users.AnyAsync(u => u.Phone == phone)) throw new WorkflowException("This phone number is already registered.");
        db.Customers.Add(new Customer
        {
            User = new AppUser { Name = r.Name.Trim(), Phone = phone, Role = UserRole.Customer },
            Type = r.Type,
            Addresses = { new Address { Line = r.AddressLine, Area = r.Area, Lat = r.Lat, Lng = r.Lng, IsDefault = true } }
        });
        await db.SaveChangesAsync();
    }

    private async Task<SignedInUser> LoadAsync(string phone)
    {
        var u = await db.Users.FirstAsync(x => x.Phone == phone);
        var customerId = await db.Customers.Where(c => c.UserId == u.Id).Select(c => (int?)c.Id).FirstOrDefaultAsync();
        var driverId = await db.Drivers.Where(d => d.UserId == u.Id).Select(d => (int?)d.Id).FirstOrDefaultAsync();
        return new SignedInUser(u.Id, u.Name, u.Phone, u.Role, customerId, driverId);
    }

    public static string Normalize(string phone)
    {
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        return digits.Length == 12 && digits.StartsWith("91") ? digits[2..] : digits;
    }
}
