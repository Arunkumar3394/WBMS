using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Wbms.Api.Auth;
using Wbms.Core.Entities;
using Wbms.Data;
using Wbms.Data.Services;

namespace Wbms.Api.Controllers;

public record ProfileDto(int UserId, int? CustomerId, string Name, string Phone, UserRole Role, decimal? Balance, decimal? CreditLimit, int? CansHeld, List<Address> Addresses);

[ApiController]
[Route("api")]
[Authorize]
public class CatalogController(WbmsDbContext db, OrderService orders, InvoicePdf invoicePdf) : ControllerBase
{
    [HttpGet("products")]
    public Task<List<Product>> Products() => db.Products.AsNoTracking().Where(p => p.IsActive).ToListAsync();

    [HttpPost("products")]
    [Authorize(Roles = Roles.Staff)]
    public async Task<Product> AddProduct(Product p) { p.Id = 0; db.Products.Add(p); await db.SaveChangesAsync(); return p; }

    /// <summary>The signed-in user's profile; customers also get dues, credit and cans held.</summary>
    [HttpGet("me")]
    public async Task<ProfileDto> Me()
    {
        var userId = int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? User.FindFirst("sub")!.Value);
        var u = await db.Users.AsNoTracking().FirstAsync(x => x.Id == userId);
        var c = await db.Customers.AsNoTracking().Include(x => x.Addresses).FirstOrDefaultAsync(x => x.UserId == userId);
        return new ProfileDto(u.Id, c?.Id, u.Name, u.Phone, u.Role, c?.Balance, c?.CreditLimit, c?.CansHeld, c?.Addresses ?? new());
    }

    [HttpPost("me/addresses")]
    [Authorize(Roles = Roles.Customer)]
    public async Task<Address> AddAddress(Address a)
    {
        a.Id = 0;
        a.CustomerId = User.RequireCustomerId();
        db.Addresses.Add(a);
        await db.SaveChangesAsync();
        return a;
    }

    [HttpGet("customers")]
    [Authorize(Roles = Roles.Staff)]
    public Task<List<Customer>> Customers() => db.Customers.AsNoTracking().Include(c => c.User).Include(c => c.Addresses).ToListAsync();

    [HttpPost("customers")]
    [Authorize(Roles = Roles.Staff)]
    public async Task<Customer> AddCustomer(CustomerCreateRequest r)
    {
        var c = new Customer
        {
            User = new AppUser { Name = r.Name, Phone = AuthService.Normalize(r.Phone), Role = UserRole.Customer },
            Type = r.Type, CreditLimit = r.CreditLimit,
            Addresses = { new Address { Line = r.AddressLine, Area = r.Area, Lat = r.Lat, Lng = r.Lng, IsDefault = true } }
        };
        db.Customers.Add(c);
        await db.SaveChangesAsync();
        return c;
    }

    [HttpPost("customers/{id:int}/settle")]
    [Authorize(Roles = Roles.Staff)]
    public Task<Customer> Settle(int id, SettleRequest r) => orders.SettleDuesAsync(id, r.Amount, r.Mode, r.Reference);

    /// <summary>Customers read their own invoices; staff can read anyone's.</summary>
    [HttpGet("customers/{id:int}/invoices")]
    public async Task<ActionResult<List<Invoice>>> Invoices(int id)
    {
        if (!User.IsStaff() && User.GetCustomerId() != id) return Forbid();
        return await db.Invoices.AsNoTracking().Where(i => i.CustomerId == id).OrderByDescending(i => i.IssuedAt).ToListAsync();
    }

    /// <summary>Invoice as a PDF file, for its customer or staff.</summary>
    [HttpGet("invoices/{id:int}/pdf")]
    public async Task<IActionResult> InvoicePdf(int id)
    {
        var (pdf, fileName, customerId) = await invoicePdf.RenderAsync(id);
        if (!User.IsStaff() && User.GetCustomerId() != customerId) return Forbid();
        return File(pdf, "application/pdf", fileName);
    }

    [HttpGet("drivers")]
    [Authorize(Roles = Roles.Staff)]
    public Task<List<Driver>> Drivers() => db.Drivers.AsNoTracking().Include(d => d.User).ToListAsync();

    [HttpPost("drivers")]
    [Authorize(Roles = Roles.Staff)]
    public async Task<Driver> AddDriver(DriverCreateRequest r)
    {
        var d = new Driver { User = new AppUser { Name = r.Name, Phone = AuthService.Normalize(r.Phone), Role = UserRole.Driver }, LicenseNo = r.LicenseNo, VehicleNo = r.VehicleNo, VehicleCapacity = r.VehicleCapacity };
        db.Drivers.Add(d);
        await db.SaveChangesAsync();
        return d;
    }
}
