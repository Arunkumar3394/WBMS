using System.Net;
using System.Web.Http;
using Wbms.Api47.Data;
using Wbms.Api47.Infrastructure;
using Wbms.Api47.Services;

namespace Wbms.Api47.Controllers;

/// <summary>Base for every API controller: one database context per request, plus the shared services.</summary>
public abstract class WbmsController : ApiController
{
    private WbmsDb? db;

    protected WbmsServices Services => WbmsServices.From(Configuration);
    protected WbmsDb Db => db ??= Services.CreateDb();
    protected OrderService Orders => new OrderService(Db, Services.OtpSender);
    protected AuthService Auth => new AuthService(Db, Services.OtpSender);

    protected IHttpActionResult Error(HttpStatusCode status, string message) => Content(status, new { error = message });
    protected IHttpActionResult Forbidden() => Error(HttpStatusCode.Forbidden, "You don't have access to this.");
    protected IHttpActionResult NoContent() => StatusCode(HttpStatusCode.NoContent);

    protected override void Dispose(bool disposing)
    {
        if (disposing) db?.Dispose();
        base.Dispose(disposing);
    }
}
