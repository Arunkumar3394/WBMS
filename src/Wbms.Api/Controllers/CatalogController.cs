using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Wbms.Core.Entities;
using Wbms.Data;
using Wbms.Data.Services;

namespace Wbms.Api.Controllers;

[ApiController]
[Route("api")]
public class CatalogController(WbmsDbContext db, OrderService orders) : ControllerBase
{
    [HttpGet("products")]
    public Task<List<Product>> Products() => db.Products.AsNoTracking().Where(p => p.IsActive).ToListAsync();

    [HttpPost("products")]
    public async Task<Product> AddProduct(Product p) { p.Id = 0; db.Products.Add(p); await db.SaveChangesAsync(); return p; }

    [HttpGet("customers")]
    public Task<List<Customer>> Customers() => db.Customers.AsNoTracking().Include(c => c.User).Include(c => c.Addresses).ToListAsync();

    [HttpPost("customers")]
    public async Task<Customer> AddCustomer(CustomerCreateRequest r)
    {
        var c = new Customer
        {
            User = new AppUser { Name = r.Name, Phone = r.Phone, Role = UserRole.Customer },
            Type = r.Type, CreditLimit = r.CreditLimit,
            Addresses = { new Address { Line = r.AddressLine, Area = r.Area, Lat = r.Lat, Lng = r.Lng, IsDefault = true } }
        };
        db.Customers.Add(c);
        await db.SaveChangesAsync();
        return c;
    }

    [HttpPost("customers/{id:int}/settle")]
    public Task<Customer> Settle(int id, SettleRequest r) => orders.SettleDuesAsync(id, r.Amount, r.Mode, r.Reference);

    [HttpGet("customers/{id:int}/invoices")]
    public Task<List<Invoice>> Invoices(int id) => db.Invoices.AsNoTracking().Where(i => i.CustomerId == id).OrderByDescending(i => i.IssuedAt).ToListAsync();

    [HttpGet("drivers")]
    public Task<List<Driver>> Drivers() => db.Drivers.AsNoTracking().Include(d => d.User).ToListAsync();

    [HttpPost("drivers")]
    public async Task<Driver> AddDriver(DriverCreateRequest r)
    {
        var d = new Driver { User = new AppUser { Name = r.Name, Phone = r.Phone, Role = UserRole.Driver }, LicenseNo = r.LicenseNo, VehicleNo = r.VehicleNo, VehicleCapacity = r.VehicleCapacity };
        db.Drivers.Add(d);
        await db.SaveChangesAsync();
        return d;
    }
}
