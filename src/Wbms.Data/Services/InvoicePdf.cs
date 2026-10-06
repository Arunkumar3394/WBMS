using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Wbms.Core.Entities;
using Wbms.Core.Services;

namespace Wbms.Data.Services;

/// <summary>Seller details printed on invoices (configuration section "Business").</summary>
public class BusinessInfo
{
    public string Name { get; set; } = "WBMS Water Supply";
    public string Address { get; set; } = "";
    public string Phone { get; set; } = "";
    public string? Gstin { get; set; }
}

/// <summary>Builds a one-page A5 invoice PDF. QuestPDF Community license: free while annual revenue is under USD 1M.</summary>
public class InvoicePdf(WbmsDbContext db, BusinessInfo business)
{
    static InvoicePdf() => QuestPDF.Settings.License = LicenseType.Community;

    public async Task<(byte[] Pdf, string FileName, int CustomerId)> RenderAsync(int invoiceId)
    {
        var invoice = await db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invoiceId)
            ?? throw new WorkflowException("Invoice not found.");
        var order = await db.Orders.AsNoTracking()
            .Include(o => o.Customer).ThenInclude(c => c.User)
            .Include(o => o.Address)
            .Include(o => o.Items).ThenInclude(i => i.Product)
            .Include(o => o.Delivery)
            .FirstAsync(o => o.Id == invoice.OrderId);

        var pdf = Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A5);
            page.Margin(28);
            page.DefaultTextStyle(t => t.FontSize(10));

            page.Header().Row(row =>
            {
                row.RelativeItem().Column(c =>
                {
                    c.Item().Text(business.Name).FontSize(16).Bold();
                    if (business.Address != "") c.Item().Text(business.Address);
                    if (business.Phone != "") c.Item().Text($"Phone: {business.Phone}");
                    if (!string.IsNullOrEmpty(business.Gstin)) c.Item().Text($"GSTIN: {business.Gstin}");
                });
                row.ConstantItem(150).AlignRight().Column(c =>
                {
                    c.Item().Text("INVOICE").FontSize(14).Bold();
                    c.Item().Text(invoice.InvoiceNo);
                    c.Item().Text(invoice.IssuedAt.ToLocalTime().ToString("dd MMM yyyy"));
                });
            });

            page.Content().PaddingVertical(14).Column(col =>
            {
                col.Spacing(10);
                col.Item().Column(c =>
                {
                    c.Item().Text("Bill to").SemiBold();
                    c.Item().Text(order.Customer.User.Name);
                    c.Item().Text($"{order.Address.Line}, {order.Address.Area}");
                    c.Item().Text(order.Customer.User.Phone);
                });

                col.Item().Table(t =>
                {
                    t.ColumnsDefinition(c => { c.RelativeColumn(4); c.RelativeColumn(1); c.RelativeColumn(2); c.RelativeColumn(2); });
                    t.Header(h =>
                    {
                        foreach (var title in new[] { "Item", "Qty", "Rate", "Amount" })
                            h.Cell().BorderBottom(1).PaddingBottom(4).Text(title).SemiBold();
                    });
                    foreach (var i in order.Items)
                    {
                        t.Cell().PaddingVertical(3).Text(i.Product.Name);
                        t.Cell().PaddingVertical(3).Text(i.Qty.ToString());
                        t.Cell().PaddingVertical(3).Text(Money(i.UnitPrice));
                        t.Cell().PaddingVertical(3).AlignRight().Text(Money(i.Qty * i.UnitPrice));
                    }
                });

                col.Item().AlignRight().Column(c =>
                {
                    if (invoice.Tax > 0) c.Item().Text($"Tax: {Money(invoice.Tax)}");
                    c.Item().Text($"Total: {Money(invoice.Amount)}").Bold().FontSize(12);
                    c.Item().Text($"Paid: {Money(invoice.AmountPaid)}");
                    if (invoice.Amount > invoice.AmountPaid) c.Item().Text($"Due: {Money(invoice.Amount - invoice.AmountPaid)}").Bold();
                });

                if (order.Delivery is { } d)
                    col.Item().Text($"Delivered {d.DeliveredAt?.ToLocalTime():dd MMM yyyy HH:mm}: {d.FullCansDelivered} full can(s) given, {d.EmptyCansCollected} empty can(s) collected.")
                        .FontColor(Colors.Grey.Darken1);
            });

            page.Footer().AlignCenter().Text($"Order {order.OrderNo} · Thank you!").FontColor(Colors.Grey.Darken1);
        })).GeneratePdf();

        return (pdf, $"{invoice.InvoiceNo}.pdf", invoice.CustomerId);
    }

    private static string Money(decimal v) => $"Rs. {v:N2}";
}
