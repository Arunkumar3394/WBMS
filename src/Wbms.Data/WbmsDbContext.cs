using Microsoft.EntityFrameworkCore;
using Wbms.Core.Entities;

namespace Wbms.Data;

public class WbmsDbContext(DbContextOptions<WbmsDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Address> Addresses => Set<Address>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Driver> Drivers => Set<Driver>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<Delivery> Deliveries => Set<Delivery>();
    public DbSet<LocationPing> LocationPings => Set<LocationPing>();
    public DbSet<CanLedgerEntry> CanLedger => Set<CanLedgerEntry>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<LoginOtp> LoginOtps => Set<LoginOtp>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        foreach (var p in b.Model.GetEntityTypes().SelectMany(t => t.GetProperties())
                     .Where(p => p.ClrType == typeof(decimal) || p.ClrType == typeof(decimal?)))
            p.SetPrecision(12);
        foreach (var p in b.Model.GetEntityTypes().SelectMany(t => t.GetProperties())
                     .Where(p => p.ClrType == typeof(decimal) || p.ClrType == typeof(decimal?)))
            p.SetScale(2);

        b.Entity<AppUser>().HasIndex(u => u.Phone).IsUnique();
        b.Entity<Order>().HasIndex(o => o.OrderNo).IsUnique();
        b.Entity<Order>().HasIndex(o => o.Status);
        b.Entity<Invoice>().HasIndex(i => i.InvoiceNo).IsUnique();
        b.Entity<Order>().HasOne(o => o.Address).WithMany();
        b.Entity<Order>().HasOne(o => o.Delivery).WithOne().HasForeignKey<Delivery>(d => d.OrderId);
        b.Entity<Order>().HasOne(o => o.Invoice).WithOne().HasForeignKey<Invoice>(i => i.OrderId);
        b.Entity<OrderItem>().Ignore(i => i.LineTotal);
        b.Entity<LocationPing>().HasIndex(p => new { p.DeliveryId, p.At });
        b.Entity<LoginOtp>().HasIndex(o => new { o.Phone, o.CreatedAt });

        // SQL Server rejects multiple cascade paths, and business records should never vanish with a parent.
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys()))
            fk.DeleteBehavior = DeleteBehavior.Restrict;
        b.Entity<OrderItem>().HasOne<Order>().WithMany(o => o.Items).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Address>().HasOne<Customer>().WithMany(c => c.Addresses).OnDelete(DeleteBehavior.Cascade);
    }
}
