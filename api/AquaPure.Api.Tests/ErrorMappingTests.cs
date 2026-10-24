using System;
using System.Net;
using AquaPure.Api.Infrastructure;
using AquaPure.Api.Payments;
using Npgsql;
using Xunit;

namespace AquaPure.Api.Tests
{
    public class ErrorMappingTests
    {
        private static PostgresException Pg(string sqlState, string message) =>
            new PostgresException(message, "ERROR", "ERROR", sqlState);

        [Fact]
        public void Business_rule_messages_from_the_database_are_shown_to_the_user()
        {
            var (status, message) = ErrorMapping.Map(Pg("P0001", "Sorry, only 2 left of 20 L Water Can."));
            Assert.Equal(HttpStatusCode.BadRequest, status);
            Assert.Equal("Sorry, only 2 left of 20 L Water Can.", message);
        }

        [Fact]
        public void Not_found_and_not_allowed_map_to_404_and_403()
        {
            Assert.Equal(HttpStatusCode.NotFound, ErrorMapping.Map(Pg("P0002", "Order not found.")).Status);
            var (status, message) = ErrorMapping.Map(Pg("42501", "permission denied for table orders"));
            Assert.Equal(HttpStatusCode.Forbidden, status);
            Assert.DoesNotContain("table", message);
        }

        [Fact]
        public void Invalid_input_is_a_400_without_database_details()
        {
            var (status, message) = ErrorMapping.Map(Pg("23514", "new row for relation \"addresses\" violates check constraint"));
            Assert.Equal(HttpStatusCode.BadRequest, status);
            Assert.DoesNotContain("relation", message);
            Assert.Equal(HttpStatusCode.BadRequest, ErrorMapping.Map(Pg("22P02", "invalid input syntax for type integer")).Status);
        }

        [Fact]
        public void Unexpected_errors_never_leak_their_message()
        {
            var (status, message) = ErrorMapping.Map(new InvalidOperationException("connection string Password=secret"));
            Assert.Equal(HttpStatusCode.InternalServerError, status);
            Assert.DoesNotContain("secret", message);
            Assert.DoesNotContain("relation", ErrorMapping.Map(Pg("42P01", "relation \"app.x\" does not exist")).Message);
        }

        [Fact]
        public void Api_and_razorpay_errors_keep_their_own_message()
        {
            Assert.Equal((HttpStatusCode)429, ErrorMapping.Map(new ApiException((HttpStatusCode)429, "Too many requests.")).Status);
            Assert.Equal(HttpStatusCode.BadGateway, ErrorMapping.Map(new RazorpayException("down")).Status);
        }
    }
}
