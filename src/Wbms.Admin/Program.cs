using Microsoft.EntityFrameworkCore;
using Wbms.Admin.Components;
using Wbms.Core.Services;
using Wbms.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents().AddInteractiveServerComponents();
builder.Services.AddDbContextFactory<WbmsDbContext>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Wbms")));
builder.Services.AddSingleton<IOtpSender, ConsoleOtpSender>();

var app = builder.Build();

using (var db = app.Services.GetRequiredService<IDbContextFactory<WbmsDbContext>>().CreateDbContext())
{
    db.Database.Migrate();
    if (app.Environment.IsDevelopment()) SeedData.Ensure(db);
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseAntiforgery();

app.MapRazorComponents<App>().AddInteractiveServerRenderMode();

app.Run();
