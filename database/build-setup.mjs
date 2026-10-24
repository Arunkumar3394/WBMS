// Combines migrations/0001–0009 and seed.sql into supabase-setup.sql: one file to paste into
// the Supabase SQL Editor. The editor runs it as a single transaction, so it either installs
// completely or not at all. `npm test` rebuilds it and runs the tests against this exact file.
import { readFile, readdir, writeFile } from 'node:fs/promises';

const migrations = (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort();
const parts = [
  `-- =====================================================================
-- AquaPure Water — complete database setup for Supabase
-- GENERATED from database/migrations/*.sql and seed.sql by build-setup.mjs: do not edit by hand.
--
-- Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
-- Then follow "After the scripts" in database/README.md.
-- =====================================================================
`,
];
for (const f of [...migrations.map((m) => `migrations/${m}`), 'seed.sql']) {
  parts.push(`\n-- >>>>> ${f}\n`, (await readFile(f, 'utf8')).trim(), '\n');
}
parts.push(`\nselect 'AquaPure database installed' as result;\n`);
await writeFile('supabase-setup.sql', parts.join(''), 'utf8');
console.log(`supabase-setup.sql: ${migrations.length} migrations + seed`);
