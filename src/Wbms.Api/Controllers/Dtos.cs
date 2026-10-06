using Wbms.Core.Entities;

namespace Wbms.Api.Controllers;

public record OrderDto(int Id, string OrderNo, int CustomerId, string CustomerName, string CustomerPhone, string Address,
    double? AddressLat, double? AddressLng, OrderStatus Status,
    PaymentMode PaymentMode, decimal Total, DateOnly SlotDate, int? DriverId, string? DriverName, List<OrderItemDto> Items,
    double? DriverLat, double? DriverLng, string? InvoiceNo);
public record OrderItemDto(int ProductId, string Product, int Qty, decimal UnitPrice);
public record AssignRequest(int DriverId);
public record LocationRequest(double Lat, double Lng);
public record OnlinePaymentRequest(decimal Amount, string Reference);
public record SettleRequest(decimal Amount, PaymentMode Mode, string? Reference);
public record CustomerCreateRequest(string Name, string Phone, CustomerType Type, decimal CreditLimit, string AddressLine, string Area, double? Lat, double? Lng);
public record DriverCreateRequest(string Name, string Phone, string? LicenseNo, string? VehicleNo, int VehicleCapacity);
