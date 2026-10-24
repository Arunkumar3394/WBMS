using System.Data.Entity;
using System.Data.Entity.Migrations;

namespace Wbms.Api47.Data;

/// <summary>
/// Used for Postgres (Supabase). Its database already exists and holds Supabase's own tables, so
/// CreateDatabaseIfNotExists would never add ours; automatic migrations create them and keep them in step with the model.
/// </summary>
public sealed class WbmsMigrations : DbMigrationsConfiguration<WbmsDb>
{
    public WbmsMigrations()
    {
        AutomaticMigrationsEnabled = true;
        AutomaticMigrationDataLossAllowed = false;
        ContextKey = "Wbms";
    }

    public static void UseFor(WbmsDb db)
    {
        if (db.Database.Connection is Npgsql.NpgsqlConnection)
            Database.SetInitializer(new MigrateDatabaseToLatestVersion<WbmsDb, WbmsMigrations>(true));
    }
}
