using System;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Http.ExceptionHandling;
using System.Web.Http.Results;
using Npgsql;

namespace AquaPure.Api.Infrastructure
{
    /// <summary>An error whose message is safe to show to the user.</summary>
    public class ApiException : Exception
    {
        public ApiException(HttpStatusCode status, string message) : base(message) { Status = status; }
        public HttpStatusCode Status { get; }
    }

    public static class ErrorMapping
    {
        /// <summary>
        /// Turns an exception into a status code and a message that is safe to show.
        /// Only messages the database raises on purpose (P0001 / P0002 / 42501) are passed on;
        /// anything else becomes a generic message, so internals never leak to the browser.
        /// </summary>
        public static (HttpStatusCode Status, string Message) Map(Exception ex)
        {
            if (ex is AggregateException agg && agg.InnerException != null) ex = agg.InnerException;

            if (ex is ApiException api) return (api.Status, api.Message);
            if (ex is Payments.RazorpayException rzp) return (HttpStatusCode.BadGateway, rzp.Message);

            if (ex is PostgresException pg)
            {
                switch (pg.SqlState)
                {
                    case "P0001": return (HttpStatusCode.BadRequest, pg.MessageText);
                    case "P0002": return (HttpStatusCode.NotFound, pg.MessageText);
                    case "42501": return (HttpStatusCode.Forbidden, "You are not allowed to do that.");
                    case "23505": return (HttpStatusCode.Conflict, "That already exists.");
                    case "23503": return (HttpStatusCode.Conflict, "This item is still in use and cannot be removed.");
                }
                // 22xxx: bad input values; 23514/23502: check / not-null constraints.
                if (pg.SqlState.StartsWith("22") || pg.SqlState == "23514" || pg.SqlState == "23502")
                    return (HttpStatusCode.BadRequest, "Some of the details are not valid. Please check and try again.");
            }

            return (HttpStatusCode.InternalServerError, "Something went wrong. Please try again in a moment.");
        }
    }

    /// <summary>Writes every unhandled error as {"error": "..."} with the right status code.</summary>
    public class JsonExceptionHandler : ExceptionHandler
    {
        public override void Handle(ExceptionHandlerContext context)
        {
            var (status, message) = ErrorMapping.Map(context.Exception);
            context.Result = new ResponseMessageResult(
                context.Request.CreateResponse(status, new ErrorBody { Error = message }));
        }

        public override bool ShouldHandle(ExceptionHandlerContext context) => true;
    }

    /// <summary>Logs server errors (not the expected 4xx business errors) to the console / trace.</summary>
    public class TraceExceptionLogger : ExceptionLogger
    {
        public override Task LogAsync(ExceptionLoggerContext context, CancellationToken cancellationToken)
        {
            var (status, _) = ErrorMapping.Map(context.Exception);
            if ((int)status >= 500)
                Trace.TraceError("{0:u} {1} {2}: {3}", DateTime.UtcNow, context.Request?.Method,
                    context.Request?.RequestUri?.AbsolutePath, context.Exception);
            return Task.CompletedTask;
        }
    }

    public class ErrorBody
    {
        public string Error { get; set; }
    }
}
