using System.Net;
using System.Web.Http;
using AquaPure.Api.Auth;
using AquaPure.Api.Infrastructure;
using Newtonsoft.Json.Linq;

namespace AquaPure.Api.Controllers
{
    public abstract class ApiControllerBase : ApiController
    {
        public AppServices Services { get; set; }
        protected Db Db => Services.Db;
        protected Settings Settings => Services.Settings;
        protected AuthUser CurrentUser => Request.GetUser();

        protected static T Found<T>(T value, string what = "That") where T : class =>
            value ?? throw new ApiException(HttpStatusCode.NotFound, what + " was not found.");

        /// <summary>Adds image_url (a full URL) next to image_path on each product.</summary>
        protected JToken WithImageUrls(JToken products)
        {
            if (products is JArray arr) foreach (var p in arr) WithImageUrls(p);
            else if (products is JObject o) o["image_url"] = Settings.ImageUrl((string)o["image_path"]);
            return products;
        }

        protected static int Offset(int page, int size) => (page < 1 ? 0 : page - 1) * size;
    }
}
