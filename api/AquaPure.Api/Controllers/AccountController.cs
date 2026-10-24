using System;
using System.Threading.Tasks;
using System.Web.Http;
using AquaPure.Api.Auth;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Models;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Controllers
{
    /// <summary>The signed-in customer's profile and saved addresses. RLS limits every query to their own rows.</summary>
    [RoutePrefix("api/me"), Require(Access.User)]
    public class AccountController : ApiControllerBase
    {
        private const string AddressColumns =
            "id, label, contact_name, contact_phone, line1, line2, landmark, city, pincode, is_default";

        [HttpGet, Route("")]
        public async Task<JToken> Me()
        {
            var me = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                select p.id, p.full_name, p.phone, p.email, p.role, p.customer_type,
                       coalesce((select sum(cans_delta) from app.can_deposit_ledger l where l.user_id = p.id), 0) as cans_with_deposit,
                       coalesce((select sum(amount) from app.can_deposit_ledger l where l.user_id = p.id), 0) as deposit_balance
                from app.profiles p where p.id = auth.uid()"));
            return Found(me, "Your profile");
        }

        [HttpPut, Route("")]
        public async Task<JToken> UpdateMe([FromBody] ProfileRequest r)
        {
            await Db.AsUser(CurrentUser, s => s.Execute(@"
                update app.profiles set full_name = @name, phone = @phone,
                       customer_type = coalesce(@type::app.customer_type, customer_type)
                where id = auth.uid()",
                new { name = r.FullName.Trim(), phone = string.IsNullOrWhiteSpace(r.Phone) ? null : r.Phone.Trim(), type = r.CustomerType }));
            return await Me();
        }

        [HttpGet, Route("addresses")]
        public Task<JArray> Addresses() =>
            Db.AsUser(CurrentUser, s => s.JsonRows(
                "select " + AddressColumns + " from app.addresses where user_id = auth.uid() order by is_default desc, created_at"));

        [HttpPost, Route("addresses")]
        public async Task<JToken> AddAddress([FromBody] AddressRequest r) =>
            await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                insert into app.addresses (user_id, label, contact_name, contact_phone, line1, line2, landmark, city, pincode, is_default)
                values (auth.uid(), coalesce(nullif(@label, ''), 'Home'), @contactName, @contactPhone, @line1, @line2, @landmark, @city, @pincode, @isDefault)
                returning " + AddressColumns, AddressArgs(r)));

        [HttpPut, Route("addresses/{id:guid}")]
        public async Task<JToken> UpdateAddress(Guid id, [FromBody] AddressRequest r)
        {
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(@"
                update app.addresses set label = coalesce(nullif(@label, ''), 'Home'), contact_name = @contactName,
                       contact_phone = @contactPhone, line1 = @line1, line2 = @line2, landmark = @landmark,
                       city = @city, pincode = @pincode, is_default = @isDefault or is_default
                where id = @id and user_id = auth.uid()
                returning " + AddressColumns, new DapperArgs(AddressArgs(r)) { ["id"] = id }));
            return Found(row, "That address");
        }

        [HttpPost, Route("addresses/{id:guid}/default")]
        public async Task<JToken> MakeDefault(Guid id)
        {
            var row = await Db.AsUser(CurrentUser, s => s.JsonRow(
                "update app.addresses set is_default = true where id = @id and user_id = auth.uid() returning " + AddressColumns, new { id }));
            return Found(row, "That address");
        }

        [HttpDelete, Route("addresses/{id:guid}")]
        public async Task<JObject> DeleteAddress(Guid id)
        {
            var n = await Db.AsUser(CurrentUser, s => s.Execute(
                "delete from app.addresses where id = @id and user_id = auth.uid()", new { id }));
            Found(n == 0 ? null : "ok", "That address");
            return new JObject { ["ok"] = true };
        }

        private static DapperArgs AddressArgs(AddressRequest r) => new DapperArgs
        {
            ["label"] = r.Label?.Trim(),
            ["contactName"] = r.ContactName.Trim(),
            ["contactPhone"] = r.ContactPhone.Trim(),
            ["line1"] = r.Line1.Trim(),
            ["line2"] = Blank(r.Line2),
            ["landmark"] = Blank(r.Landmark),
            ["city"] = r.City.Trim(),
            ["pincode"] = r.Pincode.Trim(),
            ["isDefault"] = r.IsDefault,
        };

        private static string Blank(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }
}
