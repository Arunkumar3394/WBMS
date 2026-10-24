using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

// Request bodies. JSON uses snake_case (address_id → AddressId). These checks catch bad
// input early with a clear message; the database checks everything again.
namespace AquaPure.Api.Models
{
    internal static class Patterns
    {
        public const string Phone = @"^\+?[0-9]{10,15}$";
        public const string Pincode = @"^[1-9][0-9]{5}$";
        public const string Slug = @"^[a-z0-9]+(-[a-z0-9]+)*$";
        public const string Time = @"^([01][0-9]|2[0-3]):[0-5][0-9]$";
    }

    // ---------- Customer ----------
    public class CartItem
    {
        [Range(1, int.MaxValue, ErrorMessage = "Unknown product.")]
        public int ProductId { get; set; }

        [Range(1, 1000, ErrorMessage = "Quantity must be between 1 and 1000.")]
        public int Quantity { get; set; }
    }

    public class QuoteRequest
    {
        [Required(ErrorMessage = "Please choose a delivery address.")]
        public Guid? AddressId { get; set; }

        [Required(ErrorMessage = "Your cart is empty."), MinLength(1, ErrorMessage = "Your cart is empty."), MaxLength(20)]
        public CartItem[] Items { get; set; }
    }

    public class PlaceOrderRequest : QuoteRequest
    {
        [Required(ErrorMessage = "Please choose a delivery date.")]
        public DateTime? DeliveryDate { get; set; }

        [Required(ErrorMessage = "Please choose a delivery slot.")]
        public int? SlotId { get; set; }

        [Required(ErrorMessage = "Please choose how you will pay."), RegularExpression("^(cod|razorpay)$", ErrorMessage = "Please choose how you will pay.")]
        public string PaymentMethod { get; set; }

        [StringLength(500, ErrorMessage = "Delivery notes can be up to 500 characters.")]
        public string Notes { get; set; }

        [Required(ErrorMessage = "Missing request key. Please refresh the page.")]
        public Guid? IdempotencyKey { get; set; }
    }

    public class CancelRequest
    {
        [StringLength(300)]
        public string Reason { get; set; }
    }

    public class ProfileRequest
    {
        [Required(ErrorMessage = "Please enter your name."), StringLength(100, MinimumLength = 2, ErrorMessage = "Please enter your name.")]
        public string FullName { get; set; }

        [RegularExpression(Patterns.Phone, ErrorMessage = "Enter a valid mobile number (10 digits).")]
        public string Phone { get; set; }

        [RegularExpression("^(home|office|shop|hotel|other)$")]
        public string CustomerType { get; set; }
    }

    public class AddressRequest
    {
        [StringLength(30)]
        public string Label { get; set; }

        [Required(ErrorMessage = "Enter the contact name."), StringLength(100)]
        public string ContactName { get; set; }

        [Required(ErrorMessage = "Enter a contact phone number."), RegularExpression(Patterns.Phone, ErrorMessage = "Enter a valid mobile number (10 digits).")]
        public string ContactPhone { get; set; }

        [Required(ErrorMessage = "Enter the house / flat and street."), StringLength(200, MinimumLength = 3, ErrorMessage = "Enter the house / flat and street.")]
        public string Line1 { get; set; }

        [StringLength(200)]
        public string Line2 { get; set; }

        [StringLength(100)]
        public string Landmark { get; set; }

        [Required(ErrorMessage = "Enter the city."), StringLength(60, MinimumLength = 2)]
        public string City { get; set; }

        [Required(ErrorMessage = "Enter the pincode."), RegularExpression(Patterns.Pincode, ErrorMessage = "Enter a valid 6-digit pincode.")]
        public string Pincode { get; set; }

        public bool IsDefault { get; set; }
    }

    public class EnquiryRequest
    {
        [RegularExpression("^(general|bulk_order|monthly_supply|office_supply|event)$")]
        public string EnquiryType { get; set; }

        [Required(ErrorMessage = "Please enter your name."), StringLength(100, MinimumLength = 2, ErrorMessage = "Please enter your name.")]
        public string Name { get; set; }

        [Required(ErrorMessage = "Please enter your phone number."), RegularExpression(@"^\+?[0-9 \-]{10,18}$", ErrorMessage = "Enter a valid phone number.")]
        public string Phone { get; set; }

        [EmailAddress(ErrorMessage = "Enter a valid email address."), StringLength(254)]
        public string Email { get; set; }

        [StringLength(100)]
        public string Company { get; set; }

        [StringLength(200)]
        public string QuantityNote { get; set; }

        public DateTime? PreferredDate { get; set; }

        [Required(ErrorMessage = "Please write a message."), StringLength(2000, MinimumLength = 5, ErrorMessage = "Please write a message (at least 5 characters).")]
        public string Message { get; set; }

        /// <summary>Hidden field. People leave it empty; spam bots fill it in.</summary>
        public string Website { get; set; }
    }

    // ---------- Payments ----------
    public class RazorpayOrderRequest
    {
        [Required]
        public Guid? OrderId { get; set; }
    }

    public class RazorpayVerifyRequest
    {
        [Required, StringLength(40)]
        public string RazorpayOrderId { get; set; }

        [Required, StringLength(40)]
        public string RazorpayPaymentId { get; set; }

        [Required, StringLength(128)]
        public string RazorpaySignature { get; set; }
    }

    public class RazorpayFailedRequest
    {
        [Required, StringLength(40)]
        public string RazorpayOrderId { get; set; }

        [StringLength(40)]
        public string RazorpayPaymentId { get; set; }

        [StringLength(100)]
        public string Code { get; set; }

        [StringLength(500)]
        public string Description { get; set; }
    }

    // ---------- Staff / admin ----------
    public class OrderStatusRequest
    {
        [Required, RegularExpression("^(confirmed|out_for_delivery|delivered|cancelled)$", ErrorMessage = "Unknown status.")]
        public string Status { get; set; }

        [StringLength(500)]
        public string Note { get; set; }

        [Range(0, 10000)]
        public int? CansDelivered { get; set; }

        [Range(0, 10000)]
        public int? EmptiesCollected { get; set; }
    }

    public class NotesRequest
    {
        [StringLength(1000)]
        public string Notes { get; set; }
    }

    public class NoteRequest
    {
        [StringLength(300)]
        public string Note { get; set; }
    }

    public class StockRequest
    {
        [Range(-100000, 100000)]
        public int Delta { get; set; }

        [Required, RegularExpression("^(restock|adjustment|damaged)$")]
        public string Reason { get; set; }

        [StringLength(300)]
        public string Note { get; set; }
    }

    public class ProductRequest
    {
        [Required] public int? CategoryId { get; set; }
        [Required, RegularExpression(Patterns.Slug, ErrorMessage = "Use lowercase letters, numbers and dashes for the web address name."), StringLength(80)]
        public string Slug { get; set; }
        [Required, StringLength(100, MinimumLength = 2)] public string Name { get; set; }
        [StringLength(200)] public string ShortDescription { get; set; }
        [StringLength(2000)] public string Description { get; set; }
        [Required, StringLength(60)] public string UnitLabel { get; set; }
        [Required, Range(0, 1000000)] public decimal? Price { get; set; }
        [Required] public bool? IsSamplePrice { get; set; }
        [Required] public bool? IsReturnableCan { get; set; }
        [Range(0, 100000)] public decimal DepositAmount { get; set; }
        [Required] public bool? TrackStock { get; set; }
        [Range(1, 10000)] public int MinOrderQty { get; set; } = 1;
        [Range(1, 10000)] public int MaxOrderQty { get; set; } = 50;
        [StringLength(300)] public string ImagePath { get; set; }
        public int SortOrder { get; set; }
        [Required] public bool? IsActive { get; set; }
    }

    public class CategoryRequest
    {
        [Required, RegularExpression(Patterns.Slug, ErrorMessage = "Use lowercase letters, numbers and dashes for the web address name."), StringLength(60)]
        public string Slug { get; set; }
        [Required, StringLength(60, MinimumLength = 2)] public string Name { get; set; }
        [StringLength(500)] public string Description { get; set; }
        public int SortOrder { get; set; }
        [Required] public bool? IsActive { get; set; }
    }

    public class ZoneRequest
    {
        [Required, StringLength(60, MinimumLength = 2)] public string Name { get; set; }
        [Required, MaxLength(500)] public string[] Pincodes { get; set; }
        [Range(0, 100000)] public decimal DeliveryCharge { get; set; }
        [Range(0, 1000000)] public decimal? FreeDeliveryMin { get; set; }
        [Range(0, 1000000)] public decimal MinOrderAmount { get; set; }
        [Required] public bool? IsActive { get; set; }
    }

    public class SlotRequest
    {
        [Required, StringLength(40, MinimumLength = 2)] public string Label { get; set; }
        [Required, RegularExpression(Patterns.Time, ErrorMessage = "Use 24-hour time, e.g. 07:00.")] public string StartTime { get; set; }
        [Required, RegularExpression(Patterns.Time, ErrorMessage = "Use 24-hour time, e.g. 10:00.")] public string EndTime { get; set; }
        [Range(1, 10000)] public int Capacity { get; set; }
        [Range(0, 2880)] public int CutoffMinutes { get; set; }
        [Required, MinLength(1, ErrorMessage = "Choose at least one day.")] public int[] DaysOfWeek { get; set; }
        public int SortOrder { get; set; }
        [Required] public bool? IsActive { get; set; }
    }

    public class SettingsRequest
    {
        [Required] public bool? DepositEnabled { get; set; }
        [Required] public bool? CodEnabled { get; set; }
        [Required] public bool? OnlinePaymentEnabled { get; set; }
        [Range(0, 60)] public int MaxAdvanceDays { get; set; }
        [MaxLength(366)] public DateTime[] ClosedDates { get; set; }
        [Range(5, 1440)] public int UnpaidOrderExpiryMinutes { get; set; }
    }

    public class TestimonialRequest
    {
        [Required, StringLength(60, MinimumLength = 2)] public string AuthorName { get; set; }
        [StringLength(60)] public string AuthorLocation { get; set; }
        [Required, StringLength(600, MinimumLength = 10)] public string Content { get; set; }
        [Range(1, 5)] public int? Rating { get; set; }
        [Required] public bool? IsSample { get; set; }
        [Required] public bool? IsPublished { get; set; }
        public int SortOrder { get; set; }
    }

    public class EnquiryUpdateRequest
    {
        [Required, RegularExpression("^(new|in_progress|closed)$")] public string Status { get; set; }
        [StringLength(1000)] public string AdminNotes { get; set; }
    }

    public class RoleRequest
    {
        [Required, RegularExpression("^(customer|staff|admin)$")] public string Role { get; set; }
        [Required] public bool? IsActive { get; set; }
    }

    public class DepositRequest
    {
        [Required, RegularExpression("^(refunded|adjustment)$")] public string EntryType { get; set; }
        [Range(-10000, 10000)] public int Cans { get; set; }
        [Range(-1000000, 1000000)] public decimal Amount { get; set; }
        [StringLength(300)] public string Note { get; set; }
    }
}
