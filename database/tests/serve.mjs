// TEST ONLY. Serves the migrated in-memory database over the Postgres wire protocol, so the
// .NET API's integration tests can talk to it with Npgsql exactly as they would to Supabase.
// Usage: node tests/serve.mjs [port]   — prints READY when it is listening.
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createDb } from './helpers.mjs';

const port = Number(process.argv[2] ?? 54329);
const db = await createDb();

// Fixed test users, matching the ids used by the C# integration tests.
const users = [
  ['00000000-0000-4000-8000-000000000001', 'customer@example.com', 'Test Customer', 'customer'],
  ['00000000-0000-4000-8000-000000000002', 'other@example.com', 'Other Customer', 'customer'],
  ['00000000-0000-4000-8000-000000000003', 'staff@example.com', 'Test Staff', 'staff'],
  ['00000000-0000-4000-8000-000000000004', 'admin@example.com', 'Test Admin', 'admin'],
];
for (const [id, email, name, role] of users) {
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, JSON.stringify({ full_name: name })]);
  await db.query('update app.profiles set role = $2 where id = $1', [id, role]);
}

// PGlite has a single session; make it the API's own low-privilege role, as on Supabase.
await db.exec('set role wbms_api');

const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 1 });
await server.start();
console.log('READY');

const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.on('end', stop); // the test runner closes stdin when it is done
process.stdin.resume();
