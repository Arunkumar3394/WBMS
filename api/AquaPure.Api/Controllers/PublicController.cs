using System;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Http;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Models;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Controllers
{
    /// <summary>Endpoints for every visitor: catalog, delivery areas and slots, reviews, enquiries.</summary>
    [RoutePrefix("api")]
    public class PublicController : ApiControllerBase
    {
        [HttpGet, Route("health")]
        public async Task<JObject> Health()
        {
            await Db.AsAnon(s => s.Scalar<int>("select 1"));
            return new JObject { ["status"] = "ok" };
        }

        [HttpGet, Route("catalog")]
        public async Task<JToken> Catalog()
        {
            var result = await Db.AsAnon(s => s.Json(@"
                select jsonb_build_object(
                  'categories', coalesce((select jsonb_agg(c order by c.sort_order, c.name) from (
                      select id, slug, name, description, sort_order from app.product_categories where is_active) c), '[]'),
                  'products', coalesce((select jsonb_agg(p order by p.sort_order, p.name) from (
                      select p.id, p.slug, p.name, p.short_description, p.unit_label, p.price, p.is_sample_price,
                             p.is_returnable_can, p.deposit_amount, p.min_order_qty, p.max_order_qty, p.image_path,
                             (not p.track_stock or p.stock_qty > 0) as in_stock, p.sort_order,
                             p.category_id, c.slug as category_slug
                      from app.products p join app.product_categories c on c.id = p.category_id
                      where p.is_active and c.is_active) p), '[]'))::text"));
            WithImageUrls(result["products"]);
            return result;
        }

        [HttpGet, Route("catalog/products/{slug}")]
        public async Task<JToken> Product(string slug)
        {
            var product = await Db.AsAnon(s => s.JsonRow(@"
                select p.id, p.slug, p.name, p.short_description, p.description, p.unit_label, p.price, p.is_sample_price,
                       p.is_returnable_can, p.deposit_amount, p.min_order_qty, p.max_order_qty, p.image_path,
                       (not p.track_stock or p.stock_qty > 0) as in_stock,
                       p.category_id, c.slug as category_slug, c.name as category_name
                from app.products p join app.product_categories c on c.id = p.category_id
                where p.slug = @slug and p.is_active and c.is_active", new { slug }));
            return WithImageUrls(Found(product, "That product"));
        }

        /// <summary>Rules the site needs to show checkout options.</summary>
        [HttpGet, Route("settings")]
        public async Task<JToken> PublicSettings()
        {
            var s = await Db.AsAnon(x => x.JsonRow(@"
                select deposit_enabled, cod_enabled, online_payment_enabled, max_advance_days, closed_dates, timezone,
                       (now() at time zone timezone)::date as today
                from app.business_settings where id = 1"));
            // Online payment is offered only when it is switched on AND Razorpay keys are configured.
            s["online_payment_enabled"] = (bool)s["online_payment_enabled"] && Services.Razorpay != null;
            s["razorpay_key_id"] = Services.Razorpay != null ? Settings.RazorpayKeyId : null;
            return s;
        }

        [HttpGet, Route("delivery/check")]
        public async Task<JToken> CheckPincode(string pincode)
        {
            if (pincode == null || !Regex.IsMatch(pincode, "^[1-9][0-9]{5}$"))
                throw new ApiException(HttpStatusCode.BadRequest, "Enter a valid 6-digit pincode.");
            var zone = await Db.AsAnon(s => s.JsonRow(@"
                select name as zone_name, delivery_charge, free_delivery_min, min_order_amount
                from app.delivery_zones where is_active and @pincode = any (pincodes) order by id limit 1", new { pincode }));
            var result = zone ?? new JObject();
            result["pincode"] = pincode;
            result["served"] = zone != null;
            return result;
        }

        [HttpGet, Route("delivery/slots")]
        public Task<JArray> Slots(DateTime date) =>
            Db.AsAnon(s => s.JsonRows(
                "select slot_id, label, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time, remaining, is_available, reason from app.available_slots(@date::date)",
                new { date = date.Date }));

        [HttpGet, Route("testimonials")]
        public Task<JArray> Testimonials() =>
            Db.AsAnon(s => s.JsonRows(
                "select id, author_name, author_location, content, rating, is_sample from app.testimonials where is_published order by sort_order, id"));

        /// <summary>Contact form, bulk-order and monthly-supply requests.</summary>
        [HttpPost, Route("enquiries"), RateLimit("enquiry", 5, 600)]
        public async Task<JObject> SubmitEnquiry([FromBody] EnquiryRequest r)
        {
            // Spam bots fill in the hidden "website" field; pretend it worked and store nothing.
            if (!string.IsNullOrWhiteSpace(r.Website)) return new JObject { ["ok"] = true };

            const string sql = @"select app.submit_enquiry(@type::app.enquiry_type, @name, @phone, @email, @company,
                                                          @quantity, @date::date, @message)::text";
            var args = new
            {
                type = r.EnquiryType ?? "general", name = r.Name, phone = r.Phone, email = r.Email, company = r.Company,
                quantity = r.QuantityNote, date = r.PreferredDate?.Date, message = r.Message,
            };
            var user = CurrentUser;
            var id = user != null
                ? await Db.AsUser(user, s => s.Scalar<string>(sql, args))
                : await Db.AsAnon(s => s.Scalar<string>(sql, args));
            return new JObject { ["ok"] = true, ["id"] = id };
        }
    }
}
