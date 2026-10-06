using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Wbms.Core.Entities;
using Wbms.Core.Services;
using Wbms.Data.Services;

namespace Wbms.Api.Auth;

public static class Roles
{
    public const string Staff = nameof(UserRole.Admin) + "," + nameof(UserRole.Staff);
    public const string Driver = nameof(UserRole.Driver);
    public const string Customer = nameof(UserRole.Customer);
}

public static class Claims
{
    public const string CustomerId = "customer_id";
    public const string DriverId = "driver_id";

    public static int? GetCustomerId(this ClaimsPrincipal u) => int.TryParse(u.FindFirstValue(CustomerId), out var v) ? v : null;
    public static int? GetDriverId(this ClaimsPrincipal u) => int.TryParse(u.FindFirstValue(DriverId), out var v) ? v : null;
    public static bool IsStaff(this ClaimsPrincipal u) => u.IsInRole(nameof(UserRole.Admin)) || u.IsInRole(nameof(UserRole.Staff));

    public static int RequireCustomerId(this ClaimsPrincipal u) => u.GetCustomerId() ?? throw new WorkflowException("Sign in as a customer.");
    public static int RequireDriverId(this ClaimsPrincipal u) => u.GetDriverId() ?? throw new WorkflowException("Sign in as a driver.");
}

public class JwtOptions
{
    public string Issuer { get; set; } = "wbms";
    public string Audience { get; set; } = "wbms-app";
    /// <summary>At least 32 characters. Keep it out of source control in production (user secrets / environment variable Jwt__Key).</summary>
    public string Key { get; set; } = "";
    public int Days { get; set; } = 30;

    public SymmetricSecurityKey SigningKey() => new(Encoding.UTF8.GetBytes(Key));
}

public class TokenIssuer(JwtOptions options)
{
    public string Issue(SignedInUser u)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, u.UserId.ToString()),
            new(ClaimTypes.Name, u.Name),
            new(ClaimTypes.Role, u.Role.ToString()),
        };
        if (u.CustomerId is { } c) claims.Add(new(Claims.CustomerId, c.ToString()));
        if (u.DriverId is { } d) claims.Add(new(Claims.DriverId, d.ToString()));

        var token = new JwtSecurityToken(options.Issuer, options.Audience, claims,
            expires: DateTime.UtcNow.AddDays(options.Days),
            signingCredentials: new SigningCredentials(options.SigningKey(), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
