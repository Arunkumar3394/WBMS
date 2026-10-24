using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using Newtonsoft.Json;

namespace Wbms.Api47.Entities;

public enum UserRole { Admin, Staff, Driver, Customer }
public enum CustomerType { Home, Shop, Office }

/// <summary>Follows the business flow: book → pay/credit → confirm → assign → deliver (OTP) → complete.</summary>
public enum OrderStatus { Placed, PaymentPending, Paid, OnCredit, Confirmed, Assigned, OutForDelivery, Delivered, Completed, Cancelled, Failed }
public enum PaymentMode { Cash, Credit, Upi, Card, Razorpay }
public enum InvoiceStatus { Unpaid, PartiallyPaid, Paid }
public enum StockMovementType { Filled, Out, Returned, Damaged }

public class AppUser
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Phone { get; set; } = "";
    public string? Email { get; set; }
    public UserRole Role { get; set; }
    /// <summary>Only staff and admins sign in with a password; customers and drivers use a phone OTP.</summary>
    [JsonIgnore] public string? PasswordHash { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Customer
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public virtual AppUser User { get; set; } = null!;
    public CustomerType Type { get; set; }
    public decimal CreditLimit { get; set; }
    /// <summary>Amount the customer owes. Positive = due.</summary>
    public decimal Balance { get; set; }
    public decimal DepositPaid { get; set; }
    /// <summary>Returnable cans currently held by the customer.</summary>
    public int CansHeld { get; set; }
    public virtual List<Address> Addresses { get; set; } = new();
}

public class Address
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public string Line { get; set; } = "";
    public string Area { get; set; } = "";
    public double? Lat { get; set; }
    public double? Lng { get; set; }
    public bool IsDefault { get; set; }
}

public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public bool IsReturnable { get; set; }
    public int StockFull { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Driver
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public virtual AppUser User { get; set; } = null!;
    public string? LicenseNo { get; set; }
    public string? VehicleNo { get; set; }
    public int VehicleCapacity { get; set; }
}

public class Order
{
    public int Id { get; set; }
    public string OrderNo { get; set; } = "";
    public int CustomerId { get; set; }
    public virtual Customer Customer { get; set; } = null!;
    public int AddressId { get; set; }
    public virtual Address Address { get; set; } = null!;
    public OrderStatus Status { get; set; } = OrderStatus.Placed;
    public PaymentMode PaymentMode { get; set; }
    public decimal Total { get; set; }
    /// <summary>Delivery day (date only).</summary>
    public DateTime SlotDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ConfirmedAt { get; set; }
    public virtual List<OrderItem> Items { get; set; } = new();
    public virtual Delivery? Delivery { get; set; }
    public virtual Invoice? Invoice { get; set; }
}

public class OrderItem
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int ProductId { get; set; }
    public virtual Product Product { get; set; } = null!;
    public int Qty { get; set; }
    public decimal UnitPrice { get; set; }
}

/// <summary>One-to-one with Order: shares the order's key.</summary>
public class Delivery
{
    public int OrderId { get; set; }
    [JsonIgnore] public virtual Order Order { get; set; } = null!;
    public int DriverId { get; set; }
    public virtual Driver Driver { get; set; } = null!;
    public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public string? OtpHash { get; set; }
    public DateTime? OtpVerifiedAt { get; set; }
    public int FullCansDelivered { get; set; }
    public int EmptyCansCollected { get; set; }
    public decimal CashCollected { get; set; }
    public double? LastLat { get; set; }
    public double? LastLng { get; set; }
    public DateTime? LastLocationAt { get; set; }
}

public class LocationPing
{
    public long Id { get; set; }
    public int OrderId { get; set; }
    public double Lat { get; set; }
    public double Lng { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class CanLedgerEntry
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public int? OrderId { get; set; }
    public int Out { get; set; }
    public int In { get; set; }
    public int BalanceAfter { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class Payment
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public int? OrderId { get; set; }
    public decimal Amount { get; set; }
    public PaymentMode Mode { get; set; }
    public string? Reference { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

/// <summary>One-to-one with Order: shares the order's key.</summary>
public class Invoice
{
    /// <summary>Same as OrderId; the apps address invoices by this number.</summary>
    [NotMapped] public int Id => OrderId;
    public int OrderId { get; set; }
    [JsonIgnore] public virtual Order Order { get; set; } = null!;
    public string InvoiceNo { get; set; } = "";
    public int CustomerId { get; set; }
    public decimal Amount { get; set; }
    public decimal Tax { get; set; }
    public decimal AmountPaid { get; set; }
    public InvoiceStatus Status { get; set; }
    public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
}

public class StockMovement
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public int Qty { get; set; }
    public StockMovementType Type { get; set; }
    public int? OrderId { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class LoginOtp
{
    public int Id { get; set; }
    public string Phone { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public int Attempts { get; set; }
    public bool Used { get; set; }
}
