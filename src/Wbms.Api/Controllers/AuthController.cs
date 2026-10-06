using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Wbms.Api.Auth;
using Wbms.Data.Services;

namespace Wbms.Api.Controllers;

public record PhoneRequest(string Phone);
public record VerifyRequest(string Phone, string Otp);
public record TokenResponse(string Token, SignedInUser User);

[ApiController]
[Route("api/auth")]
[AllowAnonymous]
[EnableRateLimiting("auth")]
public class AuthController(AuthService auth, TokenIssuer tokens) : ControllerBase
{
    /// <summary>Customer self-sign-up. Afterwards call request-otp and verify to get a token.</summary>
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterCustomerRequest r)
    {
        await auth.RegisterCustomerAsync(r);
        return NoContent();
    }

    [HttpPost("request-otp")]
    public async Task<IActionResult> RequestOtp(PhoneRequest r)
    {
        await auth.RequestLoginOtpAsync(r.Phone);
        return NoContent();
    }

    [HttpPost("verify")]
    public async Task<TokenResponse> Verify(VerifyRequest r)
    {
        var user = await auth.VerifyLoginOtpAsync(r.Phone, r.Otp);
        return new TokenResponse(tokens.Issue(user), user);
    }
}
