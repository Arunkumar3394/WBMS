using System;
using System.Threading.Tasks;
using System.Web.Http;
using AquaPure.Api.Auth;
using AquaPure.Api.Models;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Controllers
{
    /// <summary>Orders, customers, enquiries and reports for staff and admins.</summary>
    [RoutePrefix("api/admin"), Require(Access.Staff)]
    public class AdminOrdersController : ApiControllerBase
    {
        private const int PageSize = 25;

        [HttpGet, Route("dashboard")]
        public Task<JToken> Dashboard() =>
            Db.AsUser(CurrentUser, s => s.Json("select app.admin_dashboard()::text"));

        [HttpGet, Route("orders")]
        public Task<JArray> Orders(string status = null, DateTime? date = null, string q = null, bool refunds = false, int page = 1) =>
            Db.AsUser(CurrentUser, s => s.JsonRows(@"
                select o.id, o.order_no, o.status, o.payment_method, o.payment_status, o.total, o.delivery_date,
                       o.slot_label, o.created_at, o.needs_refund,
                       p.full_name as customer_name,
                       coalesce(o.delivery_address ->> 'contact_phone', p.phone) as customer_phone,
                       o.delivery_address ->> 'pincode' as pincode
                from app.orders o join app.profiles p on p.id = o.user_id
                where (@status::text is null or o.status::text = @status)
                  and (@date::date is null or o.delivery_date = @date::date)
                  and (not @refunds or o.needs_refund)
                  and (@q::text is null or o.order_no ilike '%' || @q || '%' or p.full_name ilike '%' || @q || '%'
                       or o.delivery_address ->> 'contact_phone' like '%' || @q || '%')
                order by o.created_at desc
                limit @limit offset @offset",
                new { status = Blank(status), date = date?.Date, q = Blank(q), refunds, limit = PageSize, offset = Offset(page, PageSize) }));

        [HttpGet, Route("orders/{id:guid}")]
        public async Task<JToken> Order(Guid id)
        {
            var order = await Db.AsUser(CurrentUser, s => s.Json(OrdersController.OrderDetailSql(true), new { id }));
            return Found(order as JObject, "That order");
        }

        [HttpPost, Route("orders/{id:guid}/status")]
        public async Task<JToken> SetStatus(Guid id, [FromBody] OrderStatusRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute(
                "select app.admin_set_order_status(@id, @status::app.order_status, @note, @cans, @empties)",
                new { id, status = r.Status, note = r.Note, cans = r.CansDelivered, empties = r.EmptiesCollected }));
            return await Order(id);
        }

        [HttpPost, Route("orders/{id:guid}/cod-paid")]
        public async Task<JToken> CashReceived(Guid id)
        {
            await Db.AsUser(CurrentUser, s => s.Execute("select app.admin_mark_cod_paid(@id)", new { id }));
            return await Order(id);
        }

        [HttpPut, Route("orders/{id:guid}/notes")]
        public async Task<JToken> Notes(Guid id, [FromBody] NotesRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute("select app.admin_set_order_notes(@id, @notes)", new { id, notes = r.Notes }));
            return await Order(id);
        }

        [HttpPost, Route("orders/{id:guid}/refunded"), Require(Access.Admin)]
        public async Task<JToken> Refunded(Guid id, [FromBody] NoteRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute("select app.admin_mark_refunded(@id, @note)", new { id, note = r.Note }));
            return await Order(id);
        }

        // ---------- Customers ----------
        [HttpGet, Route("customers")]
        public Task<JArray> Customers(string q = null, int page = 1) =>
            Db.AsUser(CurrentUser, s => s.JsonRows(@"
                select p.id, p.full_name, p.phone, p.email, p.role, p.customer_type, p.is_active, p.created_at,
                       (select count(*) from app.orders o where o.user_id = p.id) as orders_count,
                       (select coalesce(sum(cans_delta), 0) from app.can_deposit_ledger l where l.user_id = p.id) as cans_with_deposit
                from app.profiles p
                where @q::text is null or p.full_name ilike '%' || @q || '%' or p.phone like '%' || @q || '%' or p.email ilike '%' || @q || '%'
                order by p.created_at desc
                limit @limit offset @offset",
                new { q = Blank(q), limit = PageSize, offset = Offset(page, PageSize) }));

        [HttpGet, Route("customers/{id:guid}")]
        public async Task<JToken> Customer(Guid id)
        {
            var c = await Db.AsUser(CurrentUser, s => s.Json(@"
                select (to_jsonb(p) || jsonb_build_object(
                  'addresses', coalesce((select jsonb_agg(a order by a.is_default desc, a.created_at) from app.addresses a where a.user_id = p.id), '[]'),
                  'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'order_no', o.order_no, 'status', o.status,
                        'payment_status', o.payment_status, 'total', o.total, 'delivery_date', o.delivery_date, 'created_at', o.created_at)
                        order by o.created_at desc) from (select * from app.orders where user_id = p.id order by created_at desc limit 50) o), '[]'),
                  'deposit_ledger', coalesce((select jsonb_agg(l order by l.created_at desc) from app.can_deposit_ledger l where l.user_id = p.id), '[]'),
                  'cans_with_deposit', (select coalesce(sum(cans_delta), 0) from app.can_deposit_ledger l where l.user_id = p.id)
                ))::text
                from app.profiles p where p.id = @id", new { id }));
            return Found(c as JObject, "That customer");
        }

        [HttpPut, Route("customers/{id:guid}/role"), Require(Access.Admin)]
        public async Task<JToken> SetRole(Guid id, [FromBody] RoleRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute("select app.admin_set_user_role(@id, @role::app.user_role, @active)",
                new { id, role = r.Role, active = r.IsActive.Value }));
            return await Customer(id);
        }

        [HttpPost, Route("customers/{id:guid}/deposits"), Require(Access.Admin)]
        public async Task<JToken> RecordDeposit(Guid id, [FromBody] DepositRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute("select app.admin_record_deposit(@id, @type::app.deposit_entry, @cans, @amount, @note)",
                new { id, type = r.EntryType, cans = r.Cans, amount = r.Amount, note = r.Note }));
            return await Customer(id);
        }

        // ---------- Enquiries ----------
        [HttpGet, Route("enquiries")]
        public Task<JArray> Enquiries(string status = null, int page = 1) =>
            Db.AsUser(CurrentUser, s => s.JsonRows(@"
                select * from app.enquiries
                where @status::text is null or status::text = @status
                order by created_at desc limit @limit offset @offset",
                new { status = Blank(status), limit = PageSize, offset = Offset(page, PageSize) }));

        [HttpPut, Route("enquiries/{id:guid}")]
        public async Task<JToken> UpdateEnquiry(Guid id, [FromBody] EnquiryUpdateRequest r)
        {
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                update app.enquiries set status = @status::app.enquiry_status, admin_notes = @notes
                where id = @id returning *", new { id, status = r.Status, notes = r.AdminNotes }));
            return Found(row, "That enquiry");
        }

        // ---------- Reports ----------
        [HttpGet, Route("reports/sales")]
        public Task<JToken> Sales(DateTime from, DateTime to) =>
            Db.AsUser(CurrentUser, s => s.Json("select app.admin_sales_summary(@from::date, @to::date)::text",
                new { from = from.Date, to = to.Date }));

        private static string Blank(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }
}
