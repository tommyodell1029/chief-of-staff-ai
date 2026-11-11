// Opens the SQLite database (jarvis.db in the data folder) and applies any pending migrations on first use.
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { dataDir } from "@/lib/paths";
import * as schema from "./schema";

type Db = BetterSQLite3Database<typeof schema>;

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { jarvisDb?: Db; jarvisSqlite?: Database.Database };

function open(): Db {
  const sqlite = new Database(path.join(dataDir(), "jarvis.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  globalForDb.jarvisSqlite = sqlite;
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

export function getDb(): Db {
  if (!globalForDb.jarvisDb) globalForDb.jarvisDb = open();
  return globalForDb.jarvisDb;
}

// The raw SQLite connection (for the backup).
export function getSqlite(): Database.Database {
  getDb();
  return globalForDb.jarvisSqlite!;
}

export { schema };
