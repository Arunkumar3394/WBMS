using System.Web.Http;

namespace Wbms.Api47.Controllers;

public class HomeController : WbmsController
{
    /// <summary>Health check. When the Angular site is built into wwwroot it answers "/" instead.</summary>
    [HttpGet, Route("api"), AllowAnonymous]
    public IHttpActionResult Get() => Ok(new { name = "WBMS API", status = "ok" });
}
