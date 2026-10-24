using System.Linq;
using System.Net;
using System.Threading.Tasks;
using System.Web.Http;
using AquaPure.Api.Auth;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Models;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Controllers
{
    /// <summary>
    /// Admin-only setup: products, categories, stock, delivery zones and slots, business settings
    /// and testimonials. Rows are never deleted where orders refer to them; they are deactivated.
    /// </summary>
    [RoutePrefix("api/admin"), Require(Access.Admin)]
    public class AdminSetupController : ApiControllerBase
    {
        // ---------- Products ----------
        private const string ProductColumns = @"id, category_id, slug, name, short_description, description, unit_label, price,
            is_sample_price, is_returnable_can, cans_per_unit, deposit_amount, track_stock, stock_qty, min_order_qty, max_order_qty,
            image_path, sort_order, is_active, created_at, updated_at";

        [HttpGet, Route("products")]
        public async Task<JToken> Products() =>
            WithImageUrls(await Db.AsUser(CurrentUser, s => s.JsonRows(
                "select " + ProductColumns + " from app.products order by sort_order, name")));

        [HttpPost, Route("products")]
        public async Task<JToken> AddProduct([FromBody] ProductRequest r)
        {
            Check(r);
            return WithImageUrls(await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                insert into app.products (category_id, slug, name, short_description, description, unit_label, price,
                    is_sample_price, is_returnable_can, cans_per_unit, deposit_amount, track_stock, min_order_qty, max_order_qty,
                    image_path, sort_order, is_active)
                values (@categoryId, @slug, @name, @shortDescription, @description, @unitLabel, @price,
                    @isSamplePrice, @isReturnableCan, @cansPerUnit, @depositAmount, @trackStock, @minOrderQty, @maxOrderQty,
                    @imagePath, @sortOrder, @isActive)
                returning " + ProductColumns, ProductArgs(r))));
        }

        [HttpPut, Route("products/{id:int}")]
        public async Task<JToken> UpdateProduct(int id, [FromBody] ProductRequest r)
        {
            Check(r);
            var args = ProductArgs(r);
            args["id"] = id;
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                update app.products set category_id = @categoryId, slug = @slug, name = @name,
                    short_description = @shortDescription, description = @description, unit_label = @unitLabel,
                    price = @price, is_sample_price = @isSamplePrice, is_returnable_can = @isReturnableCan, cans_per_unit = @cansPerUnit,
                    deposit_amount = @depositAmount, track_stock = @trackStock, min_order_qty = @minOrderQty,
                    max_order_qty = @maxOrderQty, image_path = @imagePath, sort_order = @sortOrder, is_active = @isActive
                where id = @id
                returning " + ProductColumns, args));
            return WithImageUrls(Found(row, "That product"));
        }

        /// <summary>Stock changes are always recorded (restock, correction, damaged).</summary>
        [HttpPost, Route("products/{id:int}/stock")]
        public async Task<JObject> AdjustStock(int id, [FromBody] StockRequest r)
        {
            var qty = await Db.AsUser(CurrentUser, s => s.Scalar<int>(
                "select app.admin_adjust_stock(@id, @delta, @reason::app.inventory_reason, @note)",
                new { id, delta = r.Delta, reason = r.Reason, note = r.Note }));
            return new JObject { ["stock_qty"] = qty };
        }

        [HttpGet, Route("products/{id:int}/stock")]
        public Task<JArray> StockHistory(int id) =>
            Db.AsUser(CurrentUser, s => s.JsonRows(@"
                select t.id, t.qty_delta, t.reason, t.note, t.created_at, o.order_no, p.full_name as created_by_name
                from app.inventory_transactions t
                left join app.orders o on o.id = t.order_id
                left join app.profiles p on p.id = t.created_by
                where t.product_id = @id order by t.created_at desc limit 100", new { id }));

        private static void Check(ProductRequest r)
        {
            if (r.MaxOrderQty < r.MinOrderQty)
                throw new ApiException(HttpStatusCode.BadRequest, "Maximum quantity must be at least the minimum quantity.");
        }

        private static DapperArgs ProductArgs(ProductRequest r) => new DapperArgs
        {
            ["categoryId"] = r.CategoryId, ["slug"] = r.Slug.Trim(), ["name"] = r.Name.Trim(),
            ["shortDescription"] = Blank(r.ShortDescription), ["description"] = Blank(r.Description),
            ["unitLabel"] = r.UnitLabel.Trim(), ["price"] = r.Price, ["isSamplePrice"] = r.IsSamplePrice,
            ["isReturnableCan"] = r.IsReturnableCan, ["cansPerUnit"] = r.CansPerUnit, ["depositAmount"] = r.DepositAmount, ["trackStock"] = r.TrackStock,
            ["minOrderQty"] = r.MinOrderQty, ["maxOrderQty"] = r.MaxOrderQty, ["imagePath"] = Blank(r.ImagePath),
            ["sortOrder"] = r.SortOrder, ["isActive"] = r.IsActive,
        };

        // ---------- Categories ----------
        [HttpGet, Route("categories")]
        public Task<JArray> Categories() =>
            Db.AsUser(CurrentUser, s => s.JsonRows("select * from app.product_categories order by sort_order, name"));

        [HttpPost, Route("categories")]
        public async Task<JToken> AddCategory([FromBody] CategoryRequest r) =>
            await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                insert into app.product_categories (slug, name, description, sort_order, is_active)
                values (@slug, @name, @description, @sortOrder, @isActive) returning *", CategoryArgs(r)));

        [HttpPut, Route("categories/{id:int}")]
        public async Task<JToken> UpdateCategory(int id, [FromBody] CategoryRequest r)
        {
            var args = CategoryArgs(r);
            args["id"] = id;
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                update app.product_categories set slug = @slug, name = @name, description = @description,
                    sort_order = @sortOrder, is_active = @isActive
                where id = @id returning *", args));
            return Found(row, "That category");
        }

        private static DapperArgs CategoryArgs(CategoryRequest r) => new DapperArgs
        {
            ["slug"] = r.Slug.Trim(), ["name"] = r.Name.Trim(), ["description"] = Blank(r.Description),
            ["sortOrder"] = r.SortOrder, ["isActive"] = r.IsActive,
        };

        // ---------- Delivery zones ----------
        [HttpGet, Route("zones")]
        public Task<JArray> Zones() =>
            Db.AsUser(CurrentUser, s => s.JsonRows("select * from app.delivery_zones order by id"));

        [HttpPost, Route("zones")]
        public async Task<JToken> AddZone([FromBody] ZoneRequest r) =>
            await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                insert into app.delivery_zones (name, pincodes, delivery_charge, free_delivery_min, min_order_amount, is_active)
                values (@name, @pincodes, @charge, @freeMin, @minOrder, @isActive) returning *", ZoneArgs(r)));

        [HttpPut, Route("zones/{id:int}")]
        public async Task<JToken> UpdateZone(int id, [FromBody] ZoneRequest r)
        {
            var args = ZoneArgs(r);
            args["id"] = id;
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                update app.delivery_zones set name = @name, pincodes = @pincodes, delivery_charge = @charge,
                    free_delivery_min = @freeMin, min_order_amount = @minOrder, is_active = @isActive
                where id = @id returning *", args));
            return Found(row, "That zone");
        }

        private static DapperArgs ZoneArgs(ZoneRequest r)
        {
            var pins = r.Pincodes.Select(p => (p ?? "").Trim()).Where(p => p.Length > 0).Distinct().ToArray();
            if (pins.Any(p => !System.Text.RegularExpressions.Regex.IsMatch(p, "^[1-9][0-9]{5}$")))
                throw new ApiException(HttpStatusCode.BadRequest, "Every pincode must have 6 digits.");
            return new DapperArgs
            {
                ["name"] = r.Name.Trim(), ["pincodes"] = pins, ["charge"] = r.DeliveryCharge,
                ["freeMin"] = r.FreeDeliveryMin, ["minOrder"] = r.MinOrderAmount, ["isActive"] = r.IsActive,
            };
        }

        // ---------- Delivery slots ----------
        private const string SlotColumns = @"id, label, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time,
            capacity, cutoff_minutes, days_of_week, sort_order, is_active";

        [HttpGet, Route("slots")]
        public Task<JArray> Slots() =>
            Db.AsUser(CurrentUser, s => s.JsonRows("select " + SlotColumns + " from app.delivery_slots order by sort_order, start_time"));

        [HttpPost, Route("slots")]
        public async Task<JToken> AddSlot([FromBody] SlotRequest r) =>
            await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                insert into app.delivery_slots (label, start_time, end_time, capacity, cutoff_minutes, days_of_week, sort_order, is_active)
                values (@label, @start::time, @end::time, @capacity, @cutoff, @days::smallint[], @sortOrder, @isActive)
                returning " + SlotColumns, SlotArgs(r)));

        [HttpPut, Route("slots/{id:int}")]
        public async Task<JToken> UpdateSlot(int id, [FromBody] SlotRequest r)
        {
            var args = SlotArgs(r);
            args["id"] = id;
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                update app.delivery_slots set label = @label, start_time = @start::time, end_time = @end::time,
                    capacity = @capacity, cutoff_minutes = @cutoff, days_of_week = @days::smallint[],
                    sort_order = @sortOrder, is_active = @isActive
                where id = @id returning " + SlotColumns, args));
            return Found(row, "That slot");
        }

        private static DapperArgs SlotArgs(SlotRequest r)
        {
            if (r.DaysOfWeek.Any(d => d < 1 || d > 7))
                throw new ApiException(HttpStatusCode.BadRequest, "Days must be 1 (Monday) to 7 (Sunday).");
            if (string.CompareOrdinal(r.EndTime, r.StartTime) <= 0)
                throw new ApiException(HttpStatusCode.BadRequest, "The slot must end after it starts.");
            return new DapperArgs
            {
                ["label"] = r.Label.Trim(), ["start"] = r.StartTime, ["end"] = r.EndTime, ["capacity"] = r.Capacity,
                ["cutoff"] = r.CutoffMinutes, ["days"] = r.DaysOfWeek.Distinct().OrderBy(d => d).ToArray(),
                ["sortOrder"] = r.SortOrder, ["isActive"] = r.IsActive,
            };
        }

        // ---------- Settings ----------
        [HttpGet, Route("settings")]
        public Task<JObject> GetSettings() =>
            Db.AsUser(CurrentUser, s => s.JsonRow("select * from app.business_settings where id = 1"));

        [HttpPut, Route("settings")]
        public async Task<JObject> UpdateSettings([FromBody] SettingsRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute(@"
                update app.business_settings set deposit_enabled = @deposit, cod_enabled = @cod,
                    online_payment_enabled = @online, max_advance_days = @days,
                    closed_dates = coalesce(@closed::date[], '{}'), unpaid_order_expiry_minutes = @expiry
                where id = 1", new
            {
                deposit = r.DepositEnabled, cod = r.CodEnabled, online = r.OnlinePaymentEnabled, days = r.MaxAdvanceDays,
                closed = r.ClosedDates?.Select(d => d.Date).Distinct().ToArray(), expiry = r.UnpaidOrderExpiryMinutes,
            }));
            return await GetSettings();
        }

        // ---------- Testimonials ----------
        [HttpGet, Route("testimonials")]
        public Task<JArray> Testimonials() =>
            Db.AsUser(CurrentUser, s => s.JsonRows("select * from app.testimonials order by sort_order, id"));

        [HttpPost, Route("testimonials")]
        public async Task<JToken> AddTestimonial([FromBody] TestimonialRequest r) =>
            await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                insert into app.testimonials (author_name, author_location, content, rating, is_sample, is_published, sort_order)
                values (@name, @location, @content, @rating, @isSample, @isPublished, @sortOrder) returning *", TestimonialArgs(r)));

        [HttpPut, Route("testimonials/{id:int}")]
        public async Task<JToken> UpdateTestimonial(int id, [FromBody] TestimonialRequest r)
        {
            var args = TestimonialArgs(r);
            args["id"] = id;
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                update app.testimonials set author_name = @name, author_location = @location, content = @content,
                    rating = @rating, is_sample = @isSample, is_published = @isPublished, sort_order = @sortOrder
                where id = @id returning *", args));
            return Found(row, "That review");
        }

        [HttpDelete, Route("testimonials/{id:int}")]
        public async Task<JObject> DeleteTestimonial(int id)
        {
            await Db.AsUser(CurrentUser, s => s.Execute("delete from app.testimonials where id = @id", new { id }));
            return new JObject { ["ok"] = true };
        }

        private static DapperArgs TestimonialArgs(TestimonialRequest r) => new DapperArgs
        {
            ["name"] = r.AuthorName.Trim(), ["location"] = Blank(r.AuthorLocation), ["content"] = r.Content.Trim(),
            ["rating"] = r.Rating, ["isSample"] = r.IsSample, ["isPublished"] = r.IsPublished, ["sortOrder"] = r.SortOrder,
        };

        private static string Blank(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }
}
