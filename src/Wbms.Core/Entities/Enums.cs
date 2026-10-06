namespace Wbms.Core.Entities;

public enum UserRole { Admin, Staff, Driver, Customer }

public enum CustomerType { Home, Shop, Office }

/// <summary>Follows the business flow: book → pay/credit → confirm → assign → deliver (OTP) → complete.</summary>
public enum OrderStatus
{
    Placed,
    PaymentPending,
    Paid,
    OnCredit,
    Confirmed,
    Assigned,
    OutForDelivery,
    Delivered,
    Completed,
    Cancelled,
    Failed
}

public enum PaymentMode { Cash, Credit, Upi, Card, Razorpay }

public enum InvoiceStatus { Unpaid, PartiallyPaid, Paid }

public enum StockMovementType { Filled, Out, Returned, Damaged }
