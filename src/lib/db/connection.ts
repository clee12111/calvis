import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

// Use globalThis to persist DB across Next.js hot reloads and API route contexts
const globalDb = globalThis as unknown as {
  __calvisDb?: ReturnType<typeof drizzle>;
  __calvisPglite?: PGlite;
};

let _db: ReturnType<typeof drizzle> | null = globalDb.__calvisDb ?? null;
let _pglite: PGlite | null = globalDb.__calvisPglite ?? null;

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    criticality_tier INTEGER NOT NULL,
    quiet_hours_start INTEGER,
    quiet_hours_end INTEGER,
    client_contact_name TEXT,
    client_contact_phone TEXT,
    zones_json TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    skills_json TEXT NOT NULL,
    armed BOOLEAN NOT NULL,
    languages_json TEXT NOT NULL,
    shift_start INTEGER NOT NULL,
    shift_end INTEGER NOT NULL,
    site_id TEXT REFERENCES sites(id),
    reliability_ack_rate REAL DEFAULT 0.9,
    reliability_avg_response REAL DEFAULT 300,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS robots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    site_id TEXT NOT NULL REFERENCES sites(id),
    patrol_route_json TEXT NOT NULL,
    sensors_json TEXT NOT NULL,
    false_positive_rate REAL NOT NULL,
    battery_level REAL DEFAULT 1.0,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    site_id TEXT NOT NULL REFERENCES sites(id),
    zone_id TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT,
    severity INTEGER NOT NULL,
    timestamp BIGINT NOT NULL,
    raw_data_json TEXT,
    ground_truth_label TEXT,
    scenario_id TEXT,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id),
    zone_id TEXT,
    status TEXT NOT NULL,
    event_ids_json TEXT NOT NULL,
    priority REAL,
    tier INTEGER,
    confidence REAL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    resolved_at BIGINT
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    inputs_json TEXT NOT NULL,
    factors_json TEXT NOT NULL,
    chosen_tier INTEGER NOT NULL,
    confidence REAL NOT NULL,
    autonomy_gate TEXT NOT NULL,
    policy_version_hash TEXT NOT NULL,
    rationale_json TEXT,
    timestamp BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL REFERENCES decisions(id),
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    source TEXT NOT NULL,
    was_real BOOLEAN,
    correct_tier INTEGER,
    notes TEXT,
    timestamp BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    guard_id TEXT NOT NULL REFERENCES guards(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    start_time BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    status TEXT NOT NULL
  );
`;

async function createPgliteDb(): Promise<ReturnType<typeof drizzle>> {
  const pglite = new PGlite();
  await pglite.waitReady;
  _pglite = pglite;
  globalDb.__calvisPglite = pglite;
  const db = (drizzle as any)(pglite, { schema });
  _db = db;
  globalDb.__calvisDb = db;
  return db;
}

export async function getDb(): Promise<ReturnType<typeof drizzle>> {
  if (!_db) {
    const db = await createPgliteDb();
    // Auto-create tables on first access
    await execCreateTables(db);
    return db;
  }
  return _db;
}

export async function createTestDb(): Promise<ReturnType<typeof drizzle>> {
  if (_db) {
    // Reuse existing instance — truncate all tables instead of re-creating
    await truncateAll();
    return _db;
  }
  const db = await createPgliteDb();
  await execCreateTables(db);
  return db;
}

async function truncateAll(): Promise<void> {
  const db = _db!;
  // Truncate in dependency order (children first) to respect FK constraints
  await db.execute(sql.raw("TRUNCATE outcomes, decisions, events, shifts, incidents, robots, guards, sites CASCADE"));
}

export async function resetDb(): Promise<void> {
  if (_db) {
    // Reuse instance — just truncate tables
    try {
      await truncateAll();
    } catch {
      // Tables may not exist yet on first call — that's fine
    }
    return;
  }
}

async function execCreateTables(db: ReturnType<typeof drizzle>): Promise<void> {
  // Split and execute each statement through Drizzle (not raw PGlite)
  // because Drizzle wraps PGlite in a way that raw .exec() tables aren't visible
  const statements = CREATE_TABLES_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
}

export async function initSchema(): Promise<ReturnType<typeof drizzle>> {
  const db = await getDb();
  await execCreateTables(db);
  return db;
}

export function getPglite(): PGlite {
  if (!_pglite) throw new Error("No pglite instance — call getDb() or createTestDb() first");
  return _pglite;
}

/** Execute raw SQL through the Drizzle connection (needed because PGlite raw exec isn't visible to Drizzle) */
export async function execSql(rawSql: string): Promise<void> {
  const db = await getDb();
  const statements = rawSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
}
