import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH = path.resolve(process.cwd(), "data", "calvis.db");

let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: Database.Database | null = null;

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
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    skills_json TEXT NOT NULL,
    armed INTEGER NOT NULL,
    languages_json TEXT NOT NULL,
    shift_start INTEGER NOT NULL,
    shift_end INTEGER NOT NULL,
    site_id TEXT REFERENCES sites(id),
    reliability_ack_rate REAL DEFAULT 0.9,
    reliability_avg_response REAL DEFAULT 300,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS robots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    site_id TEXT NOT NULL REFERENCES sites(id),
    patrol_route_json TEXT NOT NULL,
    sensors_json TEXT NOT NULL,
    false_positive_rate REAL NOT NULL,
    battery_level REAL DEFAULT 1.0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    site_id TEXT NOT NULL REFERENCES sites(id),
    zone_id TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT,
    severity INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    raw_data_json TEXT,
    ground_truth_label TEXT,
    scenario_id TEXT,
    created_at INTEGER NOT NULL
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
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER
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
    timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL REFERENCES decisions(id),
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    source TEXT NOT NULL,
    was_real INTEGER,
    correct_tier INTEGER,
    notes TEXT,
    timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    guard_id TEXT NOT NULL REFERENCES guards(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    status TEXT NOT NULL
  );
`;

function createFileDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  _sqlite = sqlite;
  return drizzle(sqlite, { schema });
}

function createMemoryDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  _sqlite = sqlite;
  return drizzle(sqlite, { schema });
}

export function getDb() {
  if (!_db) {
    _db = createFileDb();
  }
  return _db;
}

/** Create a fresh in-memory database — used by tests */
export function createTestDb() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
  }
  _db = createMemoryDb();
  _sqlite!.exec(CREATE_TABLES_SQL);
  return _db;
}

export function resetDb() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
  }
  _db = null;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

export function initSchema() {
  const db = getDb();
  if (!_sqlite) throw new Error("No sqlite instance");
  _sqlite.exec(CREATE_TABLES_SQL);
  return db;
}

export function getSqlite(): Database.Database {
  if (!_sqlite) throw new Error("No sqlite instance — call getDb() or createTestDb() first");
  return _sqlite;
}
