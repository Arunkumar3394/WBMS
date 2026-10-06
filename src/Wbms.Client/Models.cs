namespace Wbms.Client;

// Mirrors of the API's JSON. Enums travel as strings.
public enum UserRole { Admin, Staff, Driver, Customer }
public enum CustomerType { Home, Shop, Office }
public enum PaymentMode { Cash, Credit, Upi, Card, Razorpay }
public enum OrderStatus { Placed, PaymentPending, Paid, OnCredit, Confirmed, Assigned, OutForDelivery, Delivered, Completed, Cancelled, Failed }

public record SignedInUser(int UserId, string Name, string Phone, UserRole Role, int? CustomerId, int? DriverId);
public record TokenResponse(string Token, SignedInUser User);

public record Address(int Id, string Line, string Area, double? Lat, double? Lng, bool IsDefault);
public record Profile(int UserId, int? CustomerId, string Name, string Phone, UserRole Role, decimal? Balance, decimal? CreditLimit, int? CansHeld, List<Address> Addresses);
public record Product(int Id, string Name, decimal Price, bool IsReturnable)
{
    public override string ToString() => $"{Name} (₹{Price:N0})"; // shown in pickers
}
public record Invoice(int Id, string InvoiceNo, int OrderId, decimal Amount, decimal AmountPaid, string Status, DateTime IssuedAt);

public record OrderItem(int ProductId, string Product, int Qty, decimal UnitPrice);
public record Order(int Id, string OrderNo, int CustomerId, string CustomerName, string CustomerPhone, string Address,
    double? AddressLat, double? AddressLng, OrderStatus Status, PaymentMode PaymentMode, decimal Total, DateOnly SlotDate,
    int? DriverId, string? DriverName, List<OrderItem> Items, double? DriverLat, double? DriverLng, string? InvoiceNo)
{
    public string ItemsText => string.Join(", ", Items.Select(i => $"{i.Qty} × {i.Product}"));
    public bool IsActive => Status is not (OrderStatus.Completed or OrderStatus.Cancelled or OrderStatus.Failed);
}

public record OrderLine(int ProductId, int Qty);
public record BookRequest(int AddressId, PaymentMode PaymentMode, DateOnly SlotDate, List<OrderLine> Items, string? Notes);
public record CompleteRequest(string Otp, int FullCansDelivered, int EmptyCansCollected, decimal CashCollected);
public record RegisterRequest(string Name, string Phone, CustomerType Type, string AddressLine, string Area, double? Lat, double? Lng);

public record GeoPoint(double Lat, double Lng);
