using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Net.Http;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.AspNetCore.Cryptography.KeyDerivation;
using Microsoft.IdentityModel.Tokens;
using Wbms.Api47.Entities;
using Wbms.Api47.Services;

namespace Wbms.Api47.Infrastructure;

public static class Roles
{
    public const string Admin = nameof(UserRole.Admin);
    public const string Staff = nameof(UserRole.Admin) + "," + nameof(UserRole.Staff);
    public const string Driver = nameof(UserRole.Driver);
    public const string Customer = nameof(UserRole.Customer);
}

public static class ClaimsExtensions
{
    public const string CustomerId = "customer_id";
    public const string DriverId = "driver_id";

    private static string? Find(IPrincipal u, string type) => (u as ClaimsPrincipal)?.FindFirst(type)?.Value;

    public static int UserId(this IPrincipal u) =>
        int.Parse(Find(u, ClaimTypes.NameIdentifier) ?? Find(u, JwtRegisteredClaimNames.Sub) ?? throw new WorkflowException("Please sign in again."));
    public static int? GetCustomerId(this IPrincipal u) => int.TryParse(Find(u, CustomerId), out var v) ? v : (int?)null;
    public static int? GetDriverId(this IPrincipal u) => int.TryParse(Find(u, DriverId), out var v) ? v : (int?)null;
    public static bool IsStaff(this IPrincipal u) => u.IsInRole(nameof(UserRole.Admin)) || u.IsInRole(nameof(UserRole.Staff));

    public static int RequireCustomerId(this IPrincipal u) => u.GetCustomerId() ?? throw new WorkflowException("Sign in as a customer.");
    public static int RequireDriverId(this IPrincipal u) => u.GetDriverId() ?? throw new WorkflowException("Sign in as a driver.");
}

public class JwtOptions
{
    public string Issuer { get; set; } = "wbms";
    public string Audience { get; set; } = "wbms-app";
    /// <summary>At least 32 characters. Keep it out of source control in production (environment variable Jwt__Key).</summary>
    public string Key { get; set; } = "";
    public int Days { get; set; } = 30;

    public SymmetricSecurityKey SigningKey() => new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key));
}

public class TokenIssuer
{
    private readonly JwtOptions options;
    public TokenIssuer(JwtOptions options) => this.options = options;

    public string Issue(SignedInUser u)
    {
        var claims = new List<Claim>
        {
            new Claim(JwtRegisteredClaimNames.Sub, u.UserId.ToString()),
            new Claim(ClaimTypes.Name, u.Name),
            new Claim(ClaimTypes.Role, u.Role.ToString()),
        };
        if (u.CustomerId is { } c) claims.Add(new Claim(ClaimsExtensions.CustomerId, c.ToString()));
        if (u.DriverId is { } d) claims.Add(new Claim(ClaimsExtensions.DriverId, d.ToString()));

        var token = new JwtSecurityToken(options.Issuer, options.Audience, claims,
            expires: DateTime.UtcNow.AddDays(options.Days),
            signingCredentials: new SigningCredentials(options.SigningKey(), SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

/// <summary>PBKDF2-HMAC-SHA256 password hashes stored as "v1.iterations.salt.hash" (base64).</summary>
public static class PasswordHasher
{
    private const int Iterations = 100_000;

    public static string Hash(string password)
    {
        var salt = new byte[16];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(salt);
        var hash = KeyDerivation.Pbkdf2(password, salt, KeyDerivationPrf.HMACSHA256, Iterations, 32);
        return $"v1.{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string? stored, string password)
    {
        var parts = stored?.Split('.');
        if (parts is null || parts.Length != 4 || parts[0] != "v1" || !int.TryParse(parts[1], out var iterations)) return false;
        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = KeyDerivation.Pbkdf2(password, salt, KeyDerivationPrf.HMACSHA256, iterations, expected.Length);
        return Otp.FixedTimeEquals(actual, expected);
    }
}

/// <summary>
/// Signed-in users only. With roles, a signed-in user without the role gets 403 (Web API's own attribute answers 401,
/// which the apps read as "sign in again").
/// </summary>
public class RequireRoleAttribute : System.Web.Http.AuthorizeAttribute
{
    public RequireRoleAttribute() { }
    public RequireRoleAttribute(string roles) => Roles = roles;

    protected override void HandleUnauthorizedRequest(System.Web.Http.Controllers.HttpActionContext ctx)
    {
        if (ctx.RequestContext.Principal?.Identity?.IsAuthenticated == true)
            ctx.Response = ctx.Request.CreateResponse(System.Net.HttpStatusCode.Forbidden, new { error = "You don't have access to this." });
        else base.HandleUnauthorizedRequest(ctx);
    }
}
