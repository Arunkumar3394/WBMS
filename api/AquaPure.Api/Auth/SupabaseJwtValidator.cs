using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace AquaPure.Api.Auth
{
    /// <summary>The signed-in user, taken from a verified Supabase access token.</summary>
    public class AuthUser
    {
        public Guid Id { get; set; }
        public string Email { get; set; }
        public string Phone { get; set; }
        /// <summary>The token's payload as JSON, handed to Postgres as request.jwt.claims.</summary>
        public string ClaimsJson { get; set; }
    }

    /// <summary>
    /// Validates Supabase Auth access tokens: signature (project signing keys from the JWKS
    /// endpoint, or the legacy HS256 secret), issuer, audience "authenticated" and expiry.
    /// </summary>
    public class SupabaseJwtValidator
    {
        private static readonly TimeSpan KeysLifetime = TimeSpan.FromMinutes(10);
        private static readonly TimeSpan MinRefreshInterval = TimeSpan.FromSeconds(30);

        private readonly string _issuer;
        private readonly string _jwksUrl;
        private readonly SecurityKey _legacyKey;
        private readonly Func<string, Task<string>> _fetch;
        private readonly JsonWebTokenHandler _handler = new JsonWebTokenHandler();
        private readonly SemaphoreSlim _refreshLock = new SemaphoreSlim(1, 1);
        private IList<SecurityKey> _keys = new List<SecurityKey>();
        private DateTime _keysLoadedAt = DateTime.MinValue;

        /// <param name="supabaseUrl">https://YOUR-PROJECT-REF.supabase.co</param>
        /// <param name="legacyJwtSecret">Optional HS256 secret for projects without signing keys.</param>
        /// <param name="fetch">Downloads a URL as text (replaceable in tests).</param>
        public SupabaseJwtValidator(string supabaseUrl, string legacyJwtSecret, Func<string, Task<string>> fetch = null)
        {
            _issuer = supabaseUrl.TrimEnd('/') + "/auth/v1";
            _jwksUrl = _issuer + "/.well-known/jwks.json";
            if (!string.IsNullOrEmpty(legacyJwtSecret))
                _legacyKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(legacyJwtSecret));
            _fetch = fetch ?? DefaultFetch;
        }

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        private static Task<string> DefaultFetch(string url) => Http.GetStringAsync(url);

        /// <summary>Returns the user, or null if the token is missing, invalid or expired.</summary>
        public async Task<AuthUser> ValidateAsync(string token)
        {
            if (string.IsNullOrWhiteSpace(token) || token.Length > 8192) return null;

            var result = await TryValidate(token, await GetKeys(false));
            if (!result.IsValid && result.Exception is SecurityTokenSignatureKeyNotFoundException)
                result = await TryValidate(token, await GetKeys(true)); // keys were rotated

            if (!result.IsValid) return null;

            var jwt = (JsonWebToken)result.SecurityToken;
            if (!Guid.TryParse(jwt.Subject, out var id)) return null;
            jwt.TryGetPayloadValue("email", out string email);
            jwt.TryGetPayloadValue("phone", out string phone);

            return new AuthUser
            {
                Id = id,
                Email = string.IsNullOrEmpty(email) ? null : email,
                Phone = string.IsNullOrEmpty(phone) ? null : phone,
                ClaimsJson = Base64UrlEncoder.Decode(jwt.EncodedPayload),
            };
        }

        private Task<TokenValidationResult> TryValidate(string token, IList<SecurityKey> keys)
        {
            var all = _legacyKey == null ? keys : keys.Concat(new[] { _legacyKey }).ToList();
            return _handler.ValidateTokenAsync(token, new TokenValidationParameters
            {
                ValidIssuer = _issuer,
                ValidAudience = "authenticated",
                IssuerSigningKeys = all,
                ValidAlgorithms = new[] { "ES256", "RS256", "HS256" },
                RequireExpirationTime = true,
                RequireSignedTokens = true,
                ClockSkew = TimeSpan.FromSeconds(30),
            });
        }

        private async Task<IList<SecurityKey>> GetKeys(bool forceRefresh)
        {
            var age = DateTime.UtcNow - _keysLoadedAt;
            if (age < KeysLifetime && !(forceRefresh && age > MinRefreshInterval)) return _keys;

            await _refreshLock.WaitAsync();
            try
            {
                age = DateTime.UtcNow - _keysLoadedAt;
                if (age < KeysLifetime && !(forceRefresh && age > MinRefreshInterval)) return _keys;
                try
                {
                    var json = await _fetch(_jwksUrl);
                    _keys = new JsonWebKeySet(json).GetSigningKeys();
                }
                catch (Exception ex)
                {
                    // Keep the previous keys if Supabase is briefly unreachable.
                    System.Diagnostics.Trace.TraceWarning("Could not load Supabase signing keys: " + ex.Message);
                }
                _keysLoadedAt = DateTime.UtcNow;
                return _keys;
            }
            finally
            {
                _refreshLock.Release();
            }
        }
    }
}
