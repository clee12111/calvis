/**
 * Seed the Neon Postgres database with the full demo night's data.
 * Populates all tables: sites, guards, robots, events, incidents, decisions, outcomes.
 *
 * Usage: npx tsx scripts/seed-neon.ts
 * Requires: DATABASE_URL in .env pointing to Neon
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { seedWorld } from "../src/lib/engine/seed-world";
import { generateEventStream } from "../src/lib/engine/scenarios";
import { correlateEvents } from "../src/lib/engine/correlator";
import { scoreAndDecide, setEventCache, setSiteCache } from "../src/lib/engine/baseline-scorer";
import { initSchema } from "../src/lib/db/connection";
import {
  siteRepo, guardRepo, robotRepo, eventRepo, incidentRepo, decisionRepo, outcomeRepo
} from "../src/lib/db/repository";
import { generateSimOutcomes } from "../src/lib/engine/outcome-join";
import { IngestionPipeline } from "../src/lib/engine/ingestion";

async function main() {
  // Load .env manually
  const fs = await import("fs");
  const path = await import("path");
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx);
          const val = trimmed.slice(eqIdx + 1);
          if (!process.env[key]) process.env[key] = val.replace(/\r$/, "");
        }
      }
    }
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set. Add it to .env pointing to your Neon database.");
    process.exit(1);
  }

  const cleanUrl = dbUrl.trim().replace(/\r/g, "");
  console.log("Connecting to Neon...", cleanUrl.slice(0, 30) + "...");
  const client = neon(cleanUrl);

  // Create tables
  console.log("Creating tables...");
  const createSql = `
    DROP TABLE IF EXISTS shifts CASCADE;
    DROP TABLE IF EXISTS outcomes CASCADE;
    DROP TABLE IF EXISTS decisions CASCADE;
    DROP TABLE IF EXISTS incidents CASCADE;
    DROP TABLE IF EXISTS events CASCADE;
    DROP TABLE IF EXISTS robots CASCADE;
    DROP TABLE IF EXISTS guards CASCADE;
    DROP TABLE IF EXISTS sites CASCADE;

    CREATE TABLE sites (
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

    CREATE TABLE guards (
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

    CREATE TABLE robots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      site_id TEXT REFERENCES sites(id) NOT NULL,
      patrol_route_json TEXT NOT NULL,
      sensors_json TEXT NOT NULL,
      false_positive_rate REAL NOT NULL,
      battery_level REAL DEFAULT 1.0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      site_id TEXT REFERENCES sites(id) NOT NULL,
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

    CREATE TABLE incidents (
      id TEXT PRIMARY KEY,
      site_id TEXT REFERENCES sites(id) NOT NULL,
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

    CREATE TABLE decisions (
      id TEXT PRIMARY KEY,
      incident_id TEXT REFERENCES incidents(id) NOT NULL,
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

    CREATE TABLE outcomes (
      id TEXT PRIMARY KEY,
      decision_id TEXT REFERENCES decisions(id) NOT NULL,
      incident_id TEXT REFERENCES incidents(id) NOT NULL,
      source TEXT NOT NULL,
      was_real BOOLEAN,
      correct_tier INTEGER,
      notes TEXT,
      timestamp BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE shifts (
      id TEXT PRIMARY KEY,
      guard_id TEXT REFERENCES guards(id) NOT NULL,
      site_id TEXT REFERENCES sites(id) NOT NULL,
      start_time BIGINT NOT NULL,
      end_time BIGINT NOT NULL,
      status TEXT NOT NULL
    );
  `;

  // Execute each statement separately — Neon doesn't support multi-statement
  for (const stmt of createSql.split(";").map(s => s.trim()).filter(s => s.length > 0)) {
    await client.query(stmt);
  }
  console.log("Tables created.");

  // Generate data using the local PGlite pipeline (same as demo)
  console.log("Generating demo night data (seed 42)...");
  await initSchema();
  await seedWorld({ seed: 42 });

  const sites = await siteRepo.getAll();
  const guards = await guardRepo.getAll();
  const robots = await robotRepo.getAll();
  const events = generateEventStream({ seed: 42, sites, guards, robots });

  const pipeline = new IngestionPipeline(events);
  await pipeline.ingestAll();
  const dbEvents = await eventRepo.getAll();
  setEventCache(dbEvents);
  setSiteCache(sites);

  const incidents = await correlateEvents(events);
  for (const inc of incidents) {
    await scoreAndDecide(inc);
  }

  const nightEndMs = 10 * 3600 * 1000;
  await generateSimOutcomes(incidents, events, nightEndMs);

  // Now read everything from PGlite and push to Neon
  const allSites = await siteRepo.getAll();
  const allGuards = await guardRepo.getAll();
  const allRobots = await robotRepo.getAll();
  const allEvents = await eventRepo.getAll();
  const allIncidents = await incidentRepo.getAll();
  const allDecisions = await decisionRepo.getAll();
  const allOutcomes = await outcomeRepo.getAll();

  console.log(`Pushing to Neon: ${allSites.length} sites, ${allGuards.length} guards, ${allRobots.length} robots, ${allEvents.length} events, ${allIncidents.length} incidents, ${allDecisions.length} decisions, ${allOutcomes.length} outcomes`);

  // Insert sites
  for (const s of allSites) {
    await client.query(`INSERT INTO sites VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [s.id, s.name, s.address, s.criticalityTier, s.quietHoursStart, s.quietHoursEnd, s.clientContactName, s.clientContactPhone, s.zonesJson, s.createdAt]);
  }

  // Insert guards
  for (const g of allGuards) {
    await client.query(`INSERT INTO guards VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [g.id, g.name, g.skillsJson, g.armed, g.languagesJson, g.shiftStart, g.shiftEnd, g.siteId, g.reliabilityAckRate, g.reliabilityAvgResponse, g.createdAt]);
  }

  // Insert robots
  for (const r of allRobots) {
    await client.query(`INSERT INTO robots VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, r.name, r.siteId, r.patrolRouteJson, r.sensorsJson, r.falsePositiveRate, r.batteryLevel, r.createdAt]);
  }

  // Insert events (batch)
  console.log("Inserting events...");
  for (const e of allEvents) {
    await client.query(`INSERT INTO events VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.id, e.type, e.siteId, e.zoneId, e.sourceType, e.sourceId, e.severity, e.timestamp, e.rawDataJson, e.groundTruthLabel, e.scenarioId, e.createdAt]);
  }

  // Insert incidents
  console.log("Inserting incidents...");
  for (const i of allIncidents) {
    await client.query(`INSERT INTO incidents VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [i.id, i.siteId, i.zoneId, i.status, i.eventIds, i.priority, i.tier, i.confidence, i.createdAt, i.updatedAt, i.resolvedAt]);
  }

  // Insert decisions
  console.log("Inserting decisions...");
  for (const d of allDecisions) {
    await client.query(`INSERT INTO decisions VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [d.id, d.incidentId, d.inputsJson, d.factorsJson, d.chosenTier, d.confidence, d.autonomyGate, d.policyVersionHash, d.rationaleJson, d.timestamp, d.createdAt]);
  }

  // Insert outcomes
  console.log("Inserting outcomes...");
  for (const o of allOutcomes) {
    await client.query(`INSERT INTO outcomes VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [o.id, o.decisionId, o.incidentId, o.source, o.wasReal, o.correctTier, o.notes, o.timestamp, o.createdAt]);
  }

  console.log("\nDone! Neon database populated with full demo night.");
  console.log(`  ${allSites.length} sites`);
  console.log(`  ${allGuards.length} guards`);
  console.log(`  ${allRobots.length} robots`);
  console.log(`  ${allEvents.length} events`);
  console.log(`  ${allIncidents.length} incidents`);
  console.log(`  ${allDecisions.length} decisions`);
  console.log(`  ${allOutcomes.length} outcomes`);
}

main().catch(console.error);
