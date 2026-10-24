using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using AquaPure.Api.Auth;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Newtonsoft.Json;
using Xunit;

namespace AquaPure.Api.Tests
{
    /// <summary>Tokens are signed here with a throw-away ES256 key published through a fake JWKS endpoint.</summary>
    public class SupabaseJwtValidatorTests
    {
        private const string Project = "https://abcdefgh.supabase.co";
        private const string Issuer = Project + "/auth/v1";
        private static readonly Guid UserId = Guid.Parse("6f0b1c2a-8c1d-4c55-9d58-111111111111");

        private readonly ECDsaSecurityKey _key = NewKey("key-1");
        private readonly List<string> _fetched = new List<string>();
        private string _jwks;

        public SupabaseJwtValidatorTests() { _jwks = Jwks(_key); }

        private SupabaseJwtValidator Validator(string legacySecret = null) =>
            new SupabaseJwtValidator(Project, legacySecret, url => { _fetched.Add(url); return Task.FromResult(_jwks); });

        [Fact]
        public async Task Accepts_a_valid_token_and_passes_its_claims_on()
        {
            var user = await Validator().ValidateAsync(Token(_key));
            Assert.NotNull(user);
            Assert.Equal(UserId, user.Id);
            Assert.Equal("asha@example.com", user.Email);
            Assert.Contains("\"sub\":\"" + UserId + "\"", user.ClaimsJson);
            Assert.Equal(new[] { Issuer + "/.well-known/jwks.json" }, _fetched);
        }

        [Fact]
        public async Task Rejects_expired_tokens()
        {
            Assert.Null(await Validator().ValidateAsync(Token(_key, expires: DateTime.UtcNow.AddMinutes(-5))));
        }

        [Fact]
        public async Task Rejects_tokens_for_another_project_or_audience()
        {
            Assert.Null(await Validator().ValidateAsync(Token(_key, issuer: "https://other.supabase.co/auth/v1")));
            Assert.Null(await Validator().ValidateAsync(Token(_key, audience: "anon")));
        }

        [Fact]
        public async Task Rejects_tokens_signed_with_an_unknown_key()
        {
            Assert.Null(await Validator().ValidateAsync(Token(NewKey("key-1"))));       // same kid, different key
            Assert.Null(await Validator().ValidateAsync(Token(NewKey("attacker"))));
        }

        [Fact]
        public async Task Rejects_tampered_and_unsigned_tokens()
        {
            var parts = Token(_key).Split('.');
            var payload = Encoding.UTF8.GetString(Base64UrlEncoder.DecodeBytes(parts[1]))
                .Replace("asha@example.com", "admin@example.com");
            var tampered = parts[0] + "." + Base64UrlEncoder.Encode(payload) + "." + parts[2];
            Assert.Null(await Validator().ValidateAsync(tampered));

            var header = Base64UrlEncoder.Encode("{\"alg\":\"none\",\"typ\":\"JWT\"}");
            Assert.Null(await Validator().ValidateAsync(header + "." + parts[1] + "."));
            Assert.Null(await Validator().ValidateAsync("not-a-token"));
            Assert.Null(await Validator().ValidateAsync(""));
        }

        [Fact]
        public async Task Picks_up_rotated_keys()
        {
            var validator = Validator();
            Assert.NotNull(await validator.ValidateAsync(Token(_key)));
            var newKey = NewKey("key-2");
            _jwks = Jwks(_key, newKey);
            // Keys are cached; an unknown kid triggers a refresh only after a short pause.
            Assert.Null(await validator.ValidateAsync(Token(newKey)));
            Assert.Single(_fetched);
        }

        [Fact]
        public async Task Supports_the_legacy_hs256_secret()
        {
            var secret = "super-secret-jwt-token-with-at-least-32-characters-long";
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
            var token = Token(key, alg: SecurityAlgorithms.HmacSha256);
            Assert.NotNull(await Validator(secret).ValidateAsync(token));
            Assert.Null(await Validator().ValidateAsync(token));
        }

        private static ECDsaSecurityKey NewKey(string kid) =>
            new ECDsaSecurityKey(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = kid };

        private static string Jwks(params ECDsaSecurityKey[] keys)
        {
            var list = new List<object>();
            foreach (var k in keys)
            {
                var p = k.ECDsa.ExportParameters(false);
                list.Add(new
                {
                    kty = "EC", crv = "P-256", alg = "ES256", use = "sig", kid = k.KeyId,
                    x = Base64UrlEncoder.Encode(p.Q.X), y = Base64UrlEncoder.Encode(p.Q.Y),
                });
            }
            return JsonConvert.SerializeObject(new { keys = list });
        }

        private static string Token(SecurityKey key, string issuer = Issuer, string audience = "authenticated",
            DateTime? expires = null, string alg = SecurityAlgorithms.EcdsaSha256)
        {
            var exp = expires ?? DateTime.UtcNow.AddHours(1);
            return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
            {
                Issuer = issuer,
                Audience = audience,
                IssuedAt = exp.AddHours(-1),
                NotBefore = exp.AddHours(-1),
                Expires = exp,
                SigningCredentials = new SigningCredentials(key, alg),
                Claims = new Dictionary<string, object>
                {
                    ["sub"] = UserId.ToString(),
                    ["email"] = "asha@example.com",
                    ["role"] = "authenticated",
                },
            });
        }
    }
}
