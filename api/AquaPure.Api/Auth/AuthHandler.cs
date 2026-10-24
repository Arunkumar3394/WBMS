using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Http;
using System.Web.Http.Controllers;
using System.Web.Http.Filters;
using AquaPure.Api.Infrastructure;

namespace AquaPure.Api.Auth
{
    /// <summary>
    /// Reads "Authorization: Bearer &lt;Supabase access token&gt;". A valid token attaches the user
    /// to the request; an invalid or expired one is rejected with 401 so the site can refresh it.
    /// No token = anonymous visitor.
    /// </summary>
    public class AuthHandler : DelegatingHandler
    {
        public const string UserKey = "aquapure.user";
        private readonly SupabaseJwtValidator _validator;

        public AuthHandler(SupabaseJwtValidator validator) { _validator = validator; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var auth = request.Headers.Authorization;
            if (auth != null && string.Equals(auth.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase))
            {
                var user = await _validator.ValidateAsync(auth.Parameter);
                if (user == null)
                    return request.CreateResponse(HttpStatusCode.Unauthorized, new ErrorBody { Error = "Your session has expired. Please sign in again." });
                request.Properties[UserKey] = user;
            }
            return await base.SendAsync(request, cancellationToken);
        }
    }

    public static class RequestUserExtensions
    {
        public static AuthUser GetUser(this HttpRequestMessage request) =>
            request.Properties.TryGetValue(AuthHandler.UserKey, out var u) ? u as AuthUser : null;
    }

    public enum Access { User, Staff, Admin }

    /// <summary>
    /// Requires a signed-in user; with Staff/Admin also checks the role in app.profiles
    /// (never trusts the token for roles). The database checks again inside every function.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
    public class RequireAttribute : ActionFilterAttribute
    {
        private readonly Access _access;
        public RequireAttribute(Access access) { _access = access; }

        public override async Task OnActionExecutingAsync(HttpActionContext context, CancellationToken cancellationToken)
        {
            var user = context.Request.GetUser();
            if (user == null)
                throw new ApiException(HttpStatusCode.Unauthorized, "Please sign in.");

            if (_access == Access.User) return;

            var db = (Db)context.ControllerContext.Configuration.DependencyResolver.GetService(typeof(Db));
            var fn = _access == Access.Admin ? "app.is_admin()" : "app.is_staff()";
            var allowed = await db.AsUser(user, s => s.Scalar<bool>("select " + fn));
            if (!allowed)
                throw new ApiException(HttpStatusCode.Forbidden, "You are not allowed to do that.");
        }
    }
}
