using System;
using System.Collections.Generic;
using Wbms.Api47.Entities;

namespace Wbms.Api47.Controllers;

/// <summary>SlotDate is "yyyy-MM-dd" (a day, no time).</summary>
public record OrderDto(int Id, string OrderNo, int CustomerId, string CustomerName, string CustomerPhone, string Address,
    double? AddressLat, double? AddressLng, OrderStatus Status,
    PaymentMode PaymentMode, decimal Total, string SlotDate, int? DriverId, string? DriverName, string? DriverPhone, List<OrderItemDto> Items,
    double? DriverLat, double? DriverLng, DateTime? DriverLocationAt, string? InvoiceNo, int? InvoiceId, string? Notes, DateTime CreatedAt);
public record OrderItemDto(int ProductId, string Product, int Qty, decimal UnitPrice);

public record PhoneRequest(string Phone);
public record VerifyRequest(string Phone, string Otp);
public record PasswordLoginRequest(string Phone, string Password);
public record TokenResponse(string Token, Services.SignedInUser User);
public record ChangePasswordRequest(string Current, string New);

public record BookRequest(int AddressId, PaymentMode PaymentMode, DateTime SlotDate, List<Services.OrderLine> Items, string? Notes, int? CustomerId);
public record AssignRequest(int DriverId);
public record LocationRequest(double Lat, double Lng);
public record OnlinePaymentRequest(decimal Amount, string Reference);
public record PaymentLinkResponse(string Url);

public record ProfileDto(int UserId, int? CustomerId, string Name, string Phone, UserRole Role, decimal? Balance, decimal? CreditLimit, int? CansHeld, List<Address> Addresses);
public record AddressRequest(string Line, string Area, double? Lat, double? Lng, bool IsDefault);
public record SettleRequest(decimal Amount, PaymentMode Mode, string? Reference);
public record CustomerCreateRequest(string Name, string Phone, CustomerType Type, decimal CreditLimit, string AddressLine, string Area, double? Lat, double? Lng);
public record CustomerUpdateRequest(string Name, CustomerType Type, decimal CreditLimit, bool IsActive);
public record DriverCreateRequest(string Name, string Phone, string? LicenseNo, string? VehicleNo, int VehicleCapacity);

public record ProductRequest(string Name, decimal Price, bool IsReturnable);
public record ProductUpdateRequest(decimal? Price, bool? IsActive);
public record StockFillRequest(int Qty);

public record StaffRequest(string Name, string Phone, UserRole Role, string Password);
public record ActiveRequest(bool Active);
public record StaffDto(int Id, string Name, string Phone, UserRole Role, bool IsActive);

public record DashboardDto(int ToConfirm, int ToAssign, int OutForDelivery, int DeliveredToday, decimal SalesToday, decimal Dues, int CansOut, int FullStock);
public record ModeRow(PaymentMode Mode, int Count, decimal Amount);
public record DriverRow(string Name, int Deliveries, int CansOut, int CansIn, decimal Cash);
public record DayRow(string Day, int Count, decimal Amount);
public record DueRow(int CustomerId, string Name, string Phone, decimal Due, int Cans);
public record ReportDto(string From, string To, decimal Sales, decimal Collected, int Delivered, int Cancelled, int CansOut, int CansIn, decimal DuesNow, int CansWithCustomers,
    List<ModeRow> ByMode, List<DriverRow> ByDriver, List<DayRow> Daily, List<DueRow> TopDues);
