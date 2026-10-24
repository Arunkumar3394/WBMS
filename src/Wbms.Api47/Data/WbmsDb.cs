using System.ComponentModel.DataAnnotations.Schema;
using System.Data.Common;
using System.Data.Entity;
using System.Data.Entity.ModelConfiguration.Conventions;
using Wbms.Api47.Entities;

namespace Wbms.Api47.Data;

/// <summary>EF6 context. Connection string "Wbms" in App.config.</summary>
public class WbmsDb : DbContext
{
    static WbmsDb() => Database.SetInitializer(new CreateDatabaseIfNotExists<WbmsDb>());

    public WbmsDb() : base("name=Wbms") => Configure();
    public WbmsDb(DbConnection connection, bool ownsConnection) : base(connection, ownsConnection) => Configure();

    // Controllers load what they need with Include(); no lazy loading or proxies, so entities serialize cleanly.
    private void Configure()
    {
        Configuration.LazyLoadingEnabled = false;
        Configuration.ProxyCreationEnabled = false;
    }

    public DbSet<AppUser> Users { get; set; } = null!;
    public DbSet<Customer> Customers { get; set; } = null!;
    public DbSet<Address> Addresses { get; set; } = null!;
    public DbSet<Product> Products { get; set; } = null!;
    public DbSet<Driver> Drivers { get; set; } = null!;
    public DbSet<Order> Orders { get; set; } = null!;
    public DbSet<OrderItem> OrderItems { get; set; } = null!;
    public DbSet<Delivery> Deliveries { get; set; } = null!;
    public DbSet<LocationPing> LocationPings { get; set; } = null!;
    public DbSet<CanLedgerEntry> CanLedger { get; set; } = null!;
    public DbSet<Payment> Payments { get; set; } = null!;
    public DbSet<Invoice> Invoices { get; set; } = null!;
    public DbSet<StockMovement> StockMovements { get; set; } = null!;
    public DbSet<LoginOtp> LoginOtps { get; set; } = null!;

    protected override void OnModelCreating(DbModelBuilder b)
    {
        // Business records should never vanish with a parent, and SQL Server rejects multiple cascade paths.
        b.Conventions.Remove<OneToManyCascadeDeleteConvention>();
        b.Conventions.Remove<ManyToManyCascadeDeleteConvention>();
        b.Properties<decimal>().Configure(p => p.HasPrecision(12, 2));

        b.Entity<AppUser>().Property(u => u.Phone).HasMaxLength(20).IsRequired();
        b.Entity<AppUser>().Property(u => u.Name).HasMaxLength(100).IsRequired();
        b.Entity<AppUser>().HasIndex(u => u.Phone).IsUnique();

        b.Entity<Customer>().HasRequired(c => c.User).WithMany().HasForeignKey(c => c.UserId);
        b.Entity<Customer>().HasMany(c => c.Addresses).WithRequired().HasForeignKey(a => a.CustomerId).WillCascadeOnDelete(true);
        b.Entity<Driver>().HasRequired(d => d.User).WithMany().HasForeignKey(d => d.UserId);

        b.Entity<Order>().Property(o => o.OrderNo).HasMaxLength(30).IsRequired();
        b.Entity<Order>().HasIndex(o => o.OrderNo).IsUnique();
        b.Entity<Order>().HasIndex(o => o.Status);
        b.Entity<Order>().Property(o => o.SlotDate).HasColumnType("date");
        b.Entity<Order>().HasRequired(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId);
        b.Entity<Order>().HasRequired(o => o.Address).WithMany().HasForeignKey(o => o.AddressId);
        b.Entity<Order>().HasMany(o => o.Items).WithRequired().HasForeignKey(i => i.OrderId).WillCascadeOnDelete(true);
        b.Entity<OrderItem>().HasRequired(i => i.Product).WithMany().HasForeignKey(i => i.ProductId);

        // Delivery and Invoice share the order's key (one each per order).
        b.Entity<Delivery>().HasKey(d => d.OrderId);
        b.Entity<Delivery>().Property(d => d.OrderId).HasDatabaseGeneratedOption(DatabaseGeneratedOption.None);
        b.Entity<Delivery>().HasRequired(d => d.Order!).WithOptional(o => o.Delivery!);
        b.Entity<Delivery>().HasRequired(d => d.Driver).WithMany().HasForeignKey(d => d.DriverId);

        b.Entity<Invoice>().HasKey(i => i.OrderId);
        b.Entity<Invoice>().Property(i => i.OrderId).HasDatabaseGeneratedOption(DatabaseGeneratedOption.None);
        b.Entity<Invoice>().HasRequired(i => i.Order!).WithOptional(o => o.Invoice!);
        b.Entity<Invoice>().Property(i => i.InvoiceNo).HasMaxLength(40).IsRequired();
        b.Entity<Invoice>().HasIndex(i => i.InvoiceNo).IsUnique();

        b.Entity<LocationPing>().HasIndex(p => new { p.OrderId, p.At });
        b.Entity<LoginOtp>().Property(o => o.Phone).HasMaxLength(20).IsRequired();
        b.Entity<LoginOtp>().HasIndex(o => new { o.Phone, o.CreatedAt });
    }
}
