using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Wbms.Api.Auth;
using Wbms.Api.Hubs;
using Wbms.Core.Services;
using Wbms.Data;
using Wbms.Data.Services;

var builder = WebApplication.CreateBuilder(args);

var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (jwt.Key.Length < 32) throw new InvalidOperationException("Set Jwt:Key (at least 32 characters) in configuration.");
builder.Services.AddSingleton(jwt);
builder.Services.AddSingleton<TokenIssuer>();

builder.Services.AddDbContext<WbmsDbContext>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Wbms")));
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddWbmsSms(builder.Configuration);
builder.Services.AddWbmsInvoices(builder.Configuration);
builder.Services.AddSingleton(builder.Configuration.GetSection("Razorpay").Get<Wbms.Api.Controllers.RazorpayOptions>() ?? new());
builder.Services.AddHttpClient("razorpay", c => c.Timeout = TimeSpan.FromSeconds(20));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = jwt.Issuer,
        ValidAudience = jwt.Audience,
        IssuerSigningKey = jwt.SigningKey(),
    };
    // SignalR sends the token in the query string for WebSockets.
    o.Events = new JwtBearerEvents
    {
        OnMessageReceived = ctx =>
        {
            if (ctx.HttpContext.Request.Path.StartsWithSegments("/hubs") && ctx.Request.Query.TryGetValue("access_token", out var t))
                ctx.Token = t;
            return Task.CompletedTask;
        }
    };
});
// Every endpoint needs a signed-in user unless it says [AllowAnonymous].
builder.Services.AddAuthorization(o => o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

// Slow down OTP guessing and SMS spam: 10 auth calls per minute per IP.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.AddSignalR();
builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT",
        Description = "Call /api/auth/request-otp then /api/auth/verify and paste the token here."
    });
    o.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        [new Microsoft.OpenApi.Models.OpenApiSecurityScheme { Reference = new Microsoft.OpenApi.Models.OpenApiReference { Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme, Id = "Bearer" } }] = Array.Empty<string>()
    });
});
// The mobile app is not a browser, so CORS is only opened up in Development.
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyHeader().AllowAnyMethod().SetIsOriginAllowed(_ => true).AllowCredentials()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<WbmsDbContext>();
    if (db.Database.IsRelational()) db.Database.Migrate(); else db.Database.EnsureCreated();
    if (app.Environment.IsDevelopment()) SeedData.Ensure(db);
}

// Business-rule violations become 400s with a readable message.
app.UseExceptionHandler(e => e.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    ctx.Response.StatusCode = ex is WorkflowException ? 400 : 500;
    await ctx.Response.WriteAsJsonAsync(new { error = ex is WorkflowException ? ex.Message : "Unexpected error." });
}));

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors();
}

app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapControllers();
app.MapHub<TrackingHub>("/hubs/tracking");
app.MapGet("/", () => "WBMS API").AllowAnonymous();

app.Run();

public partial class Program;
