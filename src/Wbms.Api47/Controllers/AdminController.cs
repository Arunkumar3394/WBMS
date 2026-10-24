using System;
using System.Collections.Generic;
using System.Data.Entity;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Http;
using Wbms.Api47.Entities;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;

namespace Wbms.Api47.Controllers;

/// <summary>Dashboard numbers, reports and staff logins for the admin pages.</summary>
[RoutePrefix("api/admin"), RequireRole(Roles.Staff)]
public class AdminController : WbmsController
{
    [HttpGet, Route("dashboard")]
    public async Task<DashboardDto> Dashboard()
    {
        var today = DateTime.Today.ToUniversalTime();
        var newStatuses = new[] { OrderStatus.Placed, OrderStatus.Paid, OrderStatus.OnCredit };
        return new DashboardDto(
            await Db.Orders.CountAsync(o => newStatuses.Contains(o.Status)),
            await Db.Orders.CountAsync(o => o.Status == OrderStatus.Confirmed),
            await Db.Orders.CountAsync(o => o.Status == OrderStatus.OutForDelivery),
            await Db.Deliveries.CountAsync(d => d.DeliveredAt >= today),
            await Db.Invoices.Where(i => i.IssuedAt >= today).SumAsync(i => (decimal?)i.Amount) ?? 0,
            await Db.Customers.Where(c => c.Balance > 0).SumAsync(c => (decimal?)c.Balance) ?? 0,
            await Db.Customers.SumAsync(c => (int?)c.CansHeld) ?? 0,
            await Db.Products.Where(p => p.IsReturnable).SumAsync(p => (int?)p.StockFull) ?? 0);
    }

    /// <summary>Sales, collections, deliveries and dues between two days (inclusive, server-local). Defaults to this month.</summary>
    [HttpGet, Route("reports")]
    public async Task<ReportDto> Reports(DateTime? from = null, DateTime? to = null)
    {
        var first = from?.Date ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var last = to?.Date ?? DateTime.Today;
        if (last < first) throw new WorkflowException("'To' date is before 'From' date.");
        var start = first.ToUniversalTime();
        var end = last.AddDays(1).ToUniversalTime();

        var invoices = await Db.Invoices.Where(i => i.IssuedAt >= start && i.IssuedAt < end).Select(i => new { i.IssuedAt, i.Amount }).ToListAsync();
        var payments = await Db.Payments.Where(p => p.At >= start && p.At < end).Select(p => new { p.Mode, p.Amount }).ToListAsync();
        var deliveries = await Db.Deliveries.Where(d => d.DeliveredAt >= start && d.DeliveredAt < end)
            .Select(d => new { d.Driver.User.Name, d.FullCansDelivered, d.EmptyCansCollected, d.CashCollected }).ToListAsync();
        var cancelled = await Db.Orders.CountAsync(o => o.Status == OrderStatus.Cancelled && o.CreatedAt >= start && o.CreatedAt < end);
        var topDues = (await Db.Customers.Where(c => c.Balance > 0).OrderByDescending(c => c.Balance).Take(15)
            .Select(c => new { c.Id, c.User.Name, c.User.Phone, c.Balance, c.CansHeld }).ToListAsync())
            .Select(c => new DueRow(c.Id, c.Name, c.Phone, c.Balance, c.CansHeld)).ToList();

        return new ReportDto(
            first.ToString("yyyy-MM-dd"), last.ToString("yyyy-MM-dd"),
            invoices.Sum(i => i.Amount),
            payments.Sum(p => p.Amount),
            deliveries.Count,
            cancelled,
            deliveries.Sum(d => d.FullCansDelivered),
            deliveries.Sum(d => d.EmptyCansCollected),
            await Db.Customers.Where(c => c.Balance > 0).SumAsync(c => (decimal?)c.Balance) ?? 0,
            await Db.Customers.SumAsync(c => (int?)c.CansHeld) ?? 0,
            payments.GroupBy(p => p.Mode).Select(g => new ModeRow(g.Key, g.Count(), g.Sum(p => p.Amount))).OrderByDescending(m => m.Amount).ToList(),
            deliveries.GroupBy(d => d.Name).Select(g => new DriverRow(g.Key, g.Count(), g.Sum(d => d.FullCansDelivered), g.Sum(d => d.EmptyCansCollected), g.Sum(d => d.CashCollected)))
                .OrderByDescending(d => d.Deliveries).ToList(),
            invoices.GroupBy(i => DateTime.SpecifyKind(i.IssuedAt, DateTimeKind.Utc).ToLocalTime().Date)
                .Select(g => new DayRow(g.Key.ToString("yyyy-MM-dd"), g.Count(), g.Sum(i => i.Amount))).OrderByDescending(d => d.Day).ToList(),
            topDues);
    }

    [HttpGet, Route("staff"), RequireRole(Roles.Admin)]
    public async Task<List<StaffDto>> Staff() =>
        (await Db.Users.AsNoTracking().Where(u => u.Role == UserRole.Admin || u.Role == UserRole.Staff).OrderBy(u => u.Name).ToListAsync())
        .Select(u => new StaffDto(u.Id, u.Name, u.Phone, u.Role, u.IsActive)).ToList();

    [HttpPost, Route("staff"), RequireRole(Roles.Admin)]
    public async Task<StaffDto> AddStaff(StaffRequest r)
    {
        var phone = AuthService.Normalize(r.Phone);
        if (string.IsNullOrWhiteSpace(r.Name) || phone.Length != 10) throw new WorkflowException("Enter a name and a 10-digit phone number.");
        if (r.Role != UserRole.Admin && r.Role != UserRole.Staff) throw new WorkflowException("Role must be Admin or Staff.");
        if ((r.Password ?? "").Length < 8) throw new WorkflowException("Password must be at least 8 characters.");
        if (await Db.Users.AnyAsync(u => u.Phone == phone)) throw new WorkflowException("That phone number is already registered.");
        var user = new AppUser { Name = r.Name.Trim(), Phone = phone, Role = r.Role, PasswordHash = PasswordHasher.Hash(r.Password!) };
        Db.Users.Add(user);
        await Db.SaveChangesAsync();
        return new StaffDto(user.Id, user.Name, user.Phone, user.Role, user.IsActive);
    }

    [HttpPost, Route("staff/{id:int}/active"), RequireRole(Roles.Admin)]
    public async Task<StaffDto> SetStaffActive(int id, ActiveRequest r)
    {
        var u = await Db.Users.FirstOrDefaultAsync(x => x.Id == id && (x.Role == UserRole.Admin || x.Role == UserRole.Staff))
            ?? throw new WorkflowException("Staff member not found.");
        if (u.Id == User.UserId() && !r.Active) throw new WorkflowException("You can't switch off your own login.");
        u.IsActive = r.Active;
        await Db.SaveChangesAsync();
        return new StaffDto(u.Id, u.Name, u.Phone, u.Role, u.IsActive);
    }
}
