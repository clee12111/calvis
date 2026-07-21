import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  bigint,
} from "drizzle-orm/pg-core";

// --- Sites ---
export const sites = pgTable("sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  criticalityTier: integer("criticality_tier").notNull(),
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  clientContactName: text("client_contact_name"),
  clientContactPhone: text("client_contact_phone"),
  zonesJson: text("zones_json").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Guards ---
export const guards = pgTable("guards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  skillsJson: text("skills_json").notNull(),
  armed: boolean("armed").notNull(),
  languagesJson: text("languages_json").notNull(),
  shiftStart: integer("shift_start").notNull(),
  shiftEnd: integer("shift_end").notNull(),
  siteId: text("site_id").references(() => sites.id),
  reliabilityAckRate: real("reliability_ack_rate").default(0.9),
  reliabilityAvgResponse: real("reliability_avg_response").default(300),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Robots ---
export const robots = pgTable("robots", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  siteId: text("site_id").references(() => sites.id).notNull(),
  patrolRouteJson: text("patrol_route_json").notNull(),
  sensorsJson: text("sensors_json").notNull(),
  falsePositiveRate: real("false_positive_rate").notNull(),
  batteryLevel: real("battery_level").default(1.0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Events (APPEND-ONLY) ---
export const events = pgTable("events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  siteId: text("site_id").references(() => sites.id).notNull(),
  zoneId: text("zone_id"),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  severity: integer("severity").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  rawDataJson: text("raw_data_json"),
  groundTruthLabel: text("ground_truth_label"),
  scenarioId: text("scenario_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Incidents ---
export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(),
  siteId: text("site_id").references(() => sites.id).notNull(),
  zoneId: text("zone_id"),
  status: text("status").notNull(),
  eventIds: text("event_ids_json").notNull(),
  priority: real("priority"),
  tier: integer("tier"),
  confidence: real("confidence"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
});

// --- Decisions (APPEND-ONLY) ---
export const decisions = pgTable("decisions", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").references(() => incidents.id).notNull(),
  inputsJson: text("inputs_json").notNull(),
  factorsJson: text("factors_json").notNull(),
  chosenTier: integer("chosen_tier").notNull(),
  confidence: real("confidence").notNull(),
  autonomyGate: text("autonomy_gate").notNull(),
  policyVersionHash: text("policy_version_hash").notNull(),
  rationaleJson: text("rationale_json"),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Outcomes ---
export const outcomes = pgTable("outcomes", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").references(() => decisions.id).notNull(),
  incidentId: text("incident_id").references(() => incidents.id).notNull(),
  source: text("source").notNull(),
  wasReal: boolean("was_real"),
  correctTier: integer("correct_tier"),
  notes: text("notes"),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Shift Schedule ---
export const shifts = pgTable("shifts", {
  id: text("id").primaryKey(),
  guardId: text("guard_id").references(() => guards.id).notNull(),
  siteId: text("site_id").references(() => sites.id).notNull(),
  startTime: bigint("start_time", { mode: "number" }).notNull(),
  endTime: bigint("end_time", { mode: "number" }).notNull(),
  status: text("status").notNull(),
});

// Type exports
export type Site = typeof sites.$inferSelect;
export type Guard = typeof guards.$inferSelect;
export type Robot = typeof robots.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type Outcome = typeof outcomes.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
