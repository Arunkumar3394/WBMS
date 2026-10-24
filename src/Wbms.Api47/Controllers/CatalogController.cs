using System.Collections.Generic;
using System.Data.Entity;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;
using System.Web.Http;
using Wbms.Api47.Entities;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;

namespace Wbms.Api47.Controllers;

[RoutePrefix("api")]
public class CatalogController : WbmsController
{
    /// <summary>Products on sale. Staff can pass all=true to include ones switched off.</summary>
    [HttpGet, Route("products")]
    public Task<List<Product>> Products(bool all = false)
    {
        IQueryable<Product> q = Db.Products.AsNoTracking();
        if (!(all && User.IsStaff())) q = q.Where(p => p.IsActive);
        return q.OrderBy(p => p.Name).ToListAsync();
    }

    [HttpPost, Route("products"), RequireRole(Roles.Staff)]
    public async Task<Product> AddProduct(ProductRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name) || r.Price <= 0) throw new WorkflowException("Enter a name and a price above zero.");
        var p = new Product { Name = r.Name.Trim(), Price = r.Price, IsReturnable = r.IsReturnable };
        Db.Products.Add(p);
        await Db.SaveChangesAsync();
        return p;
    }

    [HttpPut, Route("products/{id:int}"), RequireRole(Roles.Staff)]
    public async Task<Product> UpdateProduct(int id, ProductUpdateRequest r)
    {
        var p = await Db.Products.FindAsync(id) ?? throw new WorkflowException("Product not found.");
        if (r.Price is { } price)
        {
            if (price <= 0) throw new WorkflowException("Price must be above zero.");
            p.Price = price;
        }
        if (r.IsActive is { } active) p.IsActive = active;
        await Db.SaveChangesAsync();
        return p;
    }

    /// <summary>Full cans/boxes filled at the plant go into stock.</summary>
    [HttpPost, Route("products/{id:int}/fill"), RequireRole(Roles.Staff)]
    public async Task<Product> Fill(int id, StockFillRequest r)
    {
        if (r.Qty <= 0) throw new WorkflowException("Quantity must be above zero.");
        var p = await Db.Products.FindAsync(id) ?? throw new WorkflowException("Product not found.");
        p.StockFull += r.Qty;
        Db.StockMovements.Add(new StockMovement { ProductId = id, Qty = r.Qty, Type = StockMovementType.Filled });
        await Db.SaveChangesAsync();
        return p;
    }

    /// <summary>The signed-in user's profile; customers also get dues, credit and cans held.</summary>
    [HttpGet, Route("me")]
    public async Task<ProfileDto> Me()
    {
        var userId = User.UserId();
        var u = await Db.Users.AsNoTracking().FirstAsync(x => x.Id == userId);
        var c = await Db.Customers.AsNoTracking().Include(x => x.Addresses).FirstOrDefaultAsync(x => x.UserId == userId);
        return new ProfileDto(u.Id, c?.Id, u.Name, u.Phone, u.Role, c?.Balance, c?.CreditLimit, c?.CansHeld,
            c?.Addresses.OrderByDescending(a => a.IsDefault).ThenBy(a => a.Id).ToList() ?? new List<Address>());
    }

    [HttpPost, Route("me/addresses"), RequireRole(Roles.Customer)]
    public async Task<Address> AddAddress(AddressRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Line)) throw new WorkflowException("Enter the address.");
        var customerId = User.RequireCustomerId();
        if (r.IsDefault)
            foreach (var old in await Db.Addresses.Where(a => a.CustomerId == customerId && a.IsDefault).ToListAsync())
                old.IsDefault = false;
        var a = new Address { CustomerId = customerId, Line = r.Line.Trim(), Area = r.Area?.Trim() ?? "", Lat = r.Lat, Lng = r.Lng, IsDefault = r.IsDefault };
        Db.Addresses.Add(a);
        await Db.SaveChangesAsync();
        return a;
    }

    [HttpPost, Route("me/password"), RequireRole(Roles.Staff)]
    public async Task<IHttpActionResult> ChangePassword(ChangePasswordRequest r)
    {
        var user = await Db.Users.FindAsync(User.UserId());
        if (user == null || !PasswordHasher.Verify(user.PasswordHash, r.Current ?? "")) throw new WorkflowException("Current password is wrong.");
        await Auth.SetPasswordAsync(user.Id, r.New);
        return NoContent();
    }

    [HttpGet, Route("customers"), RequireRole(Roles.Staff)]
    public Task<List<Customer>> Customers() =>
        Db.Customers.AsNoTracking().Include(c => c.User).Include(c => c.Addresses).OrderBy(c => c.User.Name).ToListAsync();

    [HttpPost, Route("customers"), RequireRole(Roles.Staff)]
    public async Task<Customer> AddCustomer(CustomerCreateRequest r)
    {
        var phone = AuthService.Normalize(r.Phone);
        if (string.IsNullOrWhiteSpace(r.Name) || phone.Length != 10) throw new WorkflowException("Enter a name and a 10-digit phone number.");
        if (await Db.Users.AnyAsync(u => u.Phone == phone)) throw new WorkflowException("That phone number is already registered.");
        var c = new Customer
        {
            User = new AppUser { Name = r.Name.Trim(), Phone = phone, Role = UserRole.Customer },
            Type = r.Type, CreditLimit = r.CreditLimit,
            Addresses = { new Address { Line = r.AddressLine ?? "", Area = r.Area ?? "", Lat = r.Lat, Lng = r.Lng, IsDefault = true } }
        };
        Db.Customers.Add(c);
        await Db.SaveChangesAsync();
        return c;
    }

    [HttpPut, Route("customers/{id:int}"), RequireRole(Roles.Staff)]
    public async Task<Customer> UpdateCustomer(int id, CustomerUpdateRequest r)
    {
        var c = await Db.Customers.Include(x => x.User).Include(x => x.Addresses).FirstOrDefaultAsync(x => x.Id == id)
            ?? throw new WorkflowException("Customer not found.");
        if (string.IsNullOrWhiteSpace(r.Name)) throw new WorkflowException("Name is required.");
        if (r.CreditLimit < 0) throw new WorkflowException("Credit limit cannot be negative.");
        c.User.Name = r.Name.Trim();
        c.User.IsActive = r.IsActive;
        c.Type = r.Type;
        c.CreditLimit = r.CreditLimit;
        await Db.SaveChangesAsync();
        return c;
    }

    [HttpPost, Route("customers/{id:int}/settle"), RequireRole(Roles.Staff)]
    public Task<Customer> Settle(int id, SettleRequest r) => Orders.SettleDuesAsync(id, r.Amount, r.Mode, r.Reference);

    /// <summary>Customers read their own invoices; staff can read anyone's.</summary>
    [HttpGet, Route("customers/{id:int}/invoices")]
    public async Task<IHttpActionResult> Invoices(int id)
    {
        if (!User.IsStaff() && User.GetCustomerId() != id) return Forbidden();
        return Ok(await Db.Invoices.AsNoTracking().Where(i => i.CustomerId == id).OrderByDescending(i => i.IssuedAt).ToListAsync());
    }

    /// <summary>Invoice as a PDF file, for its customer or staff.</summary>
    [HttpGet, Route("invoices/{id:int}/pdf")]
    public async Task<IHttpActionResult> InvoicePdf(int id)
    {
        var owner = await Db.Invoices.Where(i => i.OrderId == id).Select(i => (int?)i.CustomerId).FirstOrDefaultAsync();
        if (owner == null) return NotFound();
        if (!User.IsStaff() && User.GetCustomerId() != owner) return Forbidden();
        var invoice = await new InvoicePdf(Db, Services.Business).RenderAsync(id);
        var res = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(invoice.Pdf) };
        res.Content.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        res.Content.Headers.ContentDisposition = new ContentDispositionHeaderValue("attachment") { FileName = invoice.FileName };
        return ResponseMessage(res);
    }

    [HttpGet, Route("drivers"), RequireRole(Roles.Staff)]
    public Task<List<Driver>> Drivers() => Db.Drivers.AsNoTracking().Include(d => d.User).OrderBy(d => d.User.Name).ToListAsync();

    [HttpPost, Route("drivers"), RequireRole(Roles.Staff)]
    public async Task<Driver> AddDriver(DriverCreateRequest r)
    {
        var phone = AuthService.Normalize(r.Phone);
        if (string.IsNullOrWhiteSpace(r.Name) || phone.Length != 10) throw new WorkflowException("Enter a name and a 10-digit phone number.");
        if (await Db.Users.AnyAsync(u => u.Phone == phone)) throw new WorkflowException("That phone number is already registered.");
        var d = new Driver { User = new AppUser { Name = r.Name.Trim(), Phone = phone, Role = UserRole.Driver }, LicenseNo = r.LicenseNo, VehicleNo = r.VehicleNo, VehicleCapacity = r.VehicleCapacity };
        Db.Drivers.Add(d);
        await Db.SaveChangesAsync();
        return d;
    }

    [HttpPost, Route("drivers/{id:int}/active"), RequireRole(Roles.Staff)]
    public async Task<Driver> SetDriverActive(int id, ActiveRequest r)
    {
        var d = await Db.Drivers.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id) ?? throw new WorkflowException("Driver not found.");
        d.User.IsActive = r.Active;
        await Db.SaveChangesAsync();
        return d;
    }
}
