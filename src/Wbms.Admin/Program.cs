using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Wbms.Admin.Components;
using Wbms.Core.Services;
using Wbms.Data;
using Wbms.Data.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents().AddInteractiveServerComponents();
builder.Services.AddDbContextFactory<WbmsDbContext>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Wbms")));
builder.Services.AddWbmsSms(builder.Configuration);
builder.Services.AddWbmsInvoices(builder.Configuration);
builder.Services.AddScoped<AuthService>();

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.LoginPath = "/login";
    o.AccessDeniedPath = "/login";
    o.ExpireTimeSpan = TimeSpan.FromHours(12);
    o.SlidingExpiration = true;
    o.Cookie.HttpOnly = true;
    o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
});
builder.Services.AddAuthorization();
builder.Services.AddCascadingAuthenticationState();

var app = builder.Build();

using (var db = app.Services.GetRequiredService<IDbContextFactory<WbmsDbContext>>().CreateDbContext())
{
    if (db.Database.IsRelational()) db.Database.Migrate(); else db.Database.EnsureCreated();
    if (app.Environment.IsDevelopment()) SeedData.Ensure(db);
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();

app.MapGet("/invoices/{id:int}.pdf", async (int id, InvoicePdf invoices) =>
{
    var (pdf, fileName, _) = await invoices.RenderAsync(id);
    return Results.File(pdf, "application/pdf", fileName);
}).RequireAuthorization(new Microsoft.AspNetCore.Authorization.AuthorizeAttribute { Roles = "Admin,Staff" });

app.MapPost("/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Redirect("/login");
});

app.MapRazorComponents<App>().AddInteractiveServerRenderMode();

app.Run();
