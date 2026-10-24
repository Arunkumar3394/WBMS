using System;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Http;
using AquaPure.Api.Auth;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Controllers
{
    /// <summary>
    /// Customer orders. Prices, delivery charge, deposit and totals are always worked out by the
    /// database (app.quote_order / app.place_order); the browser only sends product ids and quantities.
    /// </summary>
    [RoutePrefix("api/orders"), Require(Access.User)]
    public class OrdersController : ApiControllerBase
    {
        [HttpPost, Route("quote")]
        public Task<JToken> Quote([FromBody] QuoteRequest r) =>
            Db.AsUser(CurrentUser, s => s.Json(
                "select app.quote_order(@address, @items::jsonb)::text",
                new { address = r.AddressId, items = ItemsJson(r) }));

        [HttpPost, Route(""), RateLimit("place-order", 20, 600)]
        public async Task<JToken> Place([FromBody] PlaceOrderRequest r)
        {
            var id = await Db.AsUser(CurrentUser, s => s.Scalar<Guid>(@"
                select app.place_order(@address, @items::jsonb, @date::date, @slot,
                                       @method::app.payment_method, @notes, @key)",
                new
                {
                    address = r.AddressId, items = ItemsJson(r), date = r.DeliveryDate.Value.Date, slot = r.SlotId,
                    method = r.PaymentMethod, notes = r.Notes, key = r.IdempotencyKey,
                }));
            return await Get(id);
        }

        [HttpGet, Route("")]
        public Task<JArray> List() =>
            Db.AsUser(CurrentUser, s => s.JsonRows(@"
                select o.id, o.order_no, o.status, o.payment_method, o.payment_status, o.total, o.delivery_date,
                       o.slot_label, o.created_at,
                       (select coalesce(sum(quantity), 0) from app.order_items i where i.order_id = o.id) as item_count
                from app.orders o where o.user_id = auth.uid()
                order by o.created_at desc limit 100"));

        [HttpGet, Route("{id:guid}")]
        public async Task<JToken> Get(Guid id)
        {
            var order = await Db.AsUser(CurrentUser, s => s.Json(OrderDetailSql(false), new { id }));
            return Found(order as JObject, "That order");
        }

        [HttpPost, Route("{id:guid}/cancel")]
        public async Task<JToken> Cancel(Guid id, [FromBody] CancelRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute("select app.cancel_my_order(@id, @reason)", new { id, reason = r?.Reason }));
            return await Get(id);
        }

        private static string ItemsJson(QuoteRequest r) =>
            JsonConvert.SerializeObject(r.Items.Select(i => new { product_id = i.ProductId, quantity = i.Quantity }));

        /// <summary>One order with its items, status history and payments. RLS decides who may see it.</summary>
        internal static string OrderDetailSql(bool forStaff) => @"
            select ((to_jsonb(o) - 'idempotency_key'" + (forStaff ? "" : " - 'admin_notes' - 'needs_refund' - 'user_id'") + @") || jsonb_build_object(
              'items', coalesce((select jsonb_agg(jsonb_build_object(
                  'product_id', i.product_id, 'product_name', i.product_name, 'unit_label', i.unit_label,
                  'unit_price', i.unit_price, 'quantity', i.quantity, 'line_total', i.line_total,
                  'deposit_qty', i.deposit_qty, 'deposit_total', i.deposit_total) order by i.id)
                from app.order_items i where i.order_id = o.id), '[]'),
              'history', coalesce((select jsonb_agg(jsonb_build_object(
                  'from_status', h.from_status, 'to_status', h.to_status, 'note', h.note, 'created_at', h.created_at) order by h.id)
                from app.order_status_history h where h.order_id = o.id), '[]'),
              'payments', coalesce((select jsonb_agg(jsonb_build_object(
                  'provider', p.provider, 'status', p.status, 'method', p.method, 'amount', p.amount_paise / 100.0,
                  'razorpay_payment_id', p.razorpay_payment_id, 'error_description', p.error_description,
                  'created_at', p.created_at, 'captured_at', p.captured_at) order by p.created_at)
                from app.payments p where p.order_id = o.id), '[]')" +
            (forStaff ? @",
              'customer', (select jsonb_build_object('id', pr.id, 'full_name', pr.full_name, 'phone', pr.phone,
                                                     'email', pr.email, 'customer_type', pr.customer_type)
                           from app.profiles pr where pr.id = o.user_id)" : "") + @"
            ))::text
            from app.orders o where o.id = @id";
    }
}
