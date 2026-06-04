#!/usr/bin/env bun
/**
 * scripts/reset-db.ts
 *
 * Drops the entire SkillWallet MongoDB database so the next backend boot
 * creates fresh collections matching the current Mongoose schemas
 * (SkillDefinition with permissionRequirements[], WalletSupportCheckRecord
 * with raw + derived fields, DelegationRecord with permissionContext +
 * caveats[], etc.).
 *
 * Built-in skills (DCA, Aerodrome Vote Optimizer) are re-seeded on boot
 * by src/skills/seed.ts via OnApplicationBootstrap.
 *
 * Usage:
 *   bun run db:reset
 *   # or directly:
 *   bun scripts/reset-db.ts
 *
 * Safety: Requires explicit --yes flag unless MONGODB_URI points to a
 * database name containing "test" (case-insensitive).
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME ?? 'skillwallet';
const args = process.argv.slice(2);
const assumeYes = args.includes('--yes') || args.includes('-y');

if (!uri) {
  console.error('MONGODB_URI not set. Aborting.');
  process.exit(1);
}

const isTestDb = /test/i.test(dbName);
if (!assumeYes && !isTestDb) {
  console.error(
    `Refusing to drop database "${dbName}" without --yes flag.\n` +
      `Re-run with: bun run db:reset -- --yes\n` +
      `Or set MONGODB_DB_NAME to a name containing "test".`,
  );
  process.exit(1);
}

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db(dbName);
  console.log(`Dropping database "${dbName}" at ${uri.replace(/\/\/.*@/, '//***@')}...`);
  await db.dropDatabase();
  console.log('Dropped. Next backend boot will recreate collections with current schemas.');
  console.log('Built-in skills (DCA, Aerodrome Vote Optimizer) will be re-seeded on boot.');
} catch (e) {
  console.error('Drop failed:', (e as Error).message);
  process.exit(1);
} finally {
  await client.close();
}
