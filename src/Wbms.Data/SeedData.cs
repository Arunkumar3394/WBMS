using Microsoft.AspNetCore.Identity;
using Wbms.Core.Entities;

namespace Wbms.Data;

public static class SeedData
{
    /// <summary>Development-only admin password. Change it before any real use.</summary>
    public const string DemoAdminPassword = "Admin@12345";

    /// <summary>Adds demo products, an admin, a driver and a customer to an empty database.</summary>
    public static void Ensure(WbmsDbContext db)
    {
        if (db.Products.Any()) return;

        db.Products.AddRange(
            new Product { Name = "20 L Water Can", Price = 40, IsReturnable = true, StockFull = 200 },
            new Product { Name = "1 L Bottle Box (12)", Price = 120, StockFull = 50 });

        var admin = new AppUser { Name = "Admin", Phone = "9000000000", Role = UserRole.Admin };
        admin.PasswordHash = new PasswordHasher<AppUser>().HashPassword(admin, DemoAdminPassword);
        db.Users.Add(admin);
        db.Drivers.Add(new Driver { User = new AppUser { Name = "Ravi (Driver)", Phone = "9000000001", Role = UserRole.Driver }, VehicleNo = "TN-01-AB-1234", VehicleCapacity = 60 });
        db.Customers.Add(new Customer
        {
            User = new AppUser { Name = "Sample Customer", Phone = "9000000002", Role = UserRole.Customer },
            Type = CustomerType.Home,
            CreditLimit = 1000,
            Addresses = { new Address { Line = "12, Main Road", Area = "Anna Nagar", IsDefault = true } }
        });
        db.SaveChanges();
    }
}
