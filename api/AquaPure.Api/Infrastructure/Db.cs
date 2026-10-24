using System;
using System.Threading.Tasks;
using AquaPure.Api.Auth;
using Dapper;
using Newtonsoft.Json.Linq;
using Npgsql;

namespace AquaPure.Api.Infrastructure
{
    /// <summary>
    /// Every query runs inside a transaction that first switches to the right Postgres role:
    ///   * AsUser  → role "authenticated" plus the caller's verified JWT claims, so auth.uid()
    ///               and all Row Level Security policies apply exactly as for that user;
    ///   * AsAnon  → role "anon" (public pages);
    ///   * AsSystem → the API's own role (wbms_api), which may only call the payment,
    ///               webhook and rate-limit functions.
    /// </summary>
    public class Db
    {
        private readonly NpgsqlDataSource _dataSource;

        public Db(string connectionString)
        {
            var csb = new NpgsqlConnectionStringBuilder(connectionString)
            {
                // Works with Supabase's session and transaction poolers.
                NoResetOnClose = true,
                ApplicationName = "aquapure-api",
            };
            if (csb.Timeout == 15) csb.Timeout = 10;
            _dataSource = NpgsqlDataSource.Create(csb.ConnectionString);
        }

        public Task<T> AsUser<T>(AuthUser user, Func<Session, Task<T>> work)
        {
            if (user == null) throw new ArgumentNullException(nameof(user));
            return Run("authenticated", user.ClaimsJson, work);
        }

        public Task<T> AsAnon<T>(Func<Session, Task<T>> work) => Run("anon", "{\"role\":\"anon\"}", work);

        public Task<T> AsSystem<T>(Func<Session, Task<T>> work) => Run(null, null, work);

        private async Task<T> Run<T>(string role, string claimsJson, Func<Session, Task<T>> work)
        {
            using (var conn = await _dataSource.OpenConnectionAsync())
            using (var tx = conn.BeginTransaction())
            {
                if (role != null)
                {
                    // set_config(..., true) is SET LOCAL: it ends with the transaction, so a pooled
                    // connection never carries one user's identity into another request.
                    await conn.ExecuteAsync(
                        "select set_config('role', @role, true), set_config('request.jwt.claims', @claims, true)",
                        new { role, claims = claimsJson }, tx);
                }
                var result = await work(new Session(conn, tx));
                tx.Commit();
                return result;
            }
        }
    }

    /// <summary>Named query parameters built up like a dictionary: new DapperArgs { ["id"] = id }.</summary>
    public class DapperArgs : DynamicParameters
    {
        public DapperArgs() { }
        public DapperArgs(DynamicParameters copyFrom) { AddDynamicParams(copyFrom); }
        public object this[string name] { set => Add(name, value); }
    }

    /// <summary>A connection + transaction already switched to the caller's role.</summary>
    public class Session
    {
        public Session(NpgsqlConnection connection, NpgsqlTransaction transaction)
        {
            Connection = connection;
            Transaction = transaction;
        }

        public NpgsqlConnection Connection { get; }
        public NpgsqlTransaction Transaction { get; }

        public Task<int> Execute(string sql, object args = null) => Connection.ExecuteAsync(sql, args, Transaction);

        public Task<T> Scalar<T>(string sql, object args = null) => Connection.ExecuteScalarAsync<T>(sql, args, Transaction);

        /// <summary>Runs a query that returns one json/jsonb value (or null) and parses it.</summary>
        public async Task<JToken> Json(string sql, object args = null)
        {
            var text = await Connection.ExecuteScalarAsync<string>(sql, args, Transaction);
            return text == null ? null : JToken.Parse(text);
        }

        // A WITH wrapper works for SELECT and for INSERT/UPDATE/DELETE ... RETURNING alike.

        /// <summary>Wraps a row-returning statement as a JSON array of objects (column names as keys).</summary>
        public async Task<JArray> JsonRows(string sql, object args = null)
        {
            var token = await Json("with t as (" + sql + ") select coalesce(jsonb_agg(t), '[]'::jsonb)::text from t", args);
            return (JArray)token;
        }

        /// <summary>Wraps a statement returning at most one row as a JSON object, or null.</summary>
        public async Task<JObject> JsonRow(string sql, object args = null)
        {
            var token = await Json("with t as (" + sql + ") select to_jsonb(t)::text from t limit 1", args);
            return token as JObject;
        }
    }
}
