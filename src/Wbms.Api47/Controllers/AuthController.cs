using System.Threading.Tasks;
using System.Web.Http;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;

namespace Wbms.Api47.Controllers;

[RoutePrefix("api/auth")]
[AllowAnonymous]
[RateLimit]
public class AuthController : WbmsController
{
    /// <summary>Customer self-sign-up. Afterwards call request-otp and verify to get a token.</summary>
    [HttpPost, Route("register")]
    public async Task<IHttpActionResult> Register(RegisterCustomerRequest r)
    {
        await Auth.RegisterCustomerAsync(r);
        return NoContent();
    }

    [HttpPost, Route("request-otp")]
    public async Task<IHttpActionResult> RequestOtp(PhoneRequest r)
    {
        await Auth.RequestLoginOtpAsync(r.Phone);
        return NoContent();
    }

    [HttpPost, Route("verify")]
    public async Task<TokenResponse> Verify(VerifyRequest r)
    {
        var user = await Auth.VerifyLoginOtpAsync(r.Phone, r.Otp);
        return new TokenResponse(Services.Tokens.Issue(user), user);
    }

    /// <summary>Password sign-in for the admin pages (Admin and Staff).</summary>
    [HttpPost, Route("password")]
    public async Task<TokenResponse> Password(PasswordLoginRequest r)
    {
        var user = await Auth.VerifyPasswordAsync(r.Phone, r.Password);
        return new TokenResponse(Services.Tokens.Issue(user), user);
    }
}
