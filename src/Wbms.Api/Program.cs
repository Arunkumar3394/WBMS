using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Wbms.Api.Hubs;
using Wbms.Core.Services;
using Wbms.Data;
using Wbms.Data.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<WbmsDbContext>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Wbms")));
builder.Services.AddScoped<OrderService>();
builder.Services.AddSingleton<IOtpSender, ConsoleOtpSender>();
builder.Services.AddSignalR();
builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyHeader().AllowAnyMethod().SetIsOriginAllowed(_ => true).AllowCredentials()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<WbmsDbContext>();
    db.Database.Migrate();
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
}

app.UseCors();
app.MapControllers();
app.MapHub<TrackingHub>("/hubs/tracking");

app.Run();
