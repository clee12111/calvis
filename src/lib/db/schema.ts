import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";

// --- Sites ---
export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  criticalityTier: integer("criticality_tier").notNull(), // 1-5, 5 = most critical
  quietHoursStart: integer("quiet_hours_start"), // hour 0-23
  quietHoursEnd: integer("quiet_hours_end"),
  clientContactName: text("client_contact_name"),
  clientContactPhone: text("client_contact_phone"),
  zonesJson: text("zones_json").notNull(), // JSON array of { id, name, geofence, exposure }
  createdAt: integer("created_at").notNull(),
});

// --- Guards ---
export const guards = sqliteTable("guards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  skillsJson: text("skills_json").notNull(), // JSON array of strings
  armed: integer("armed", { mode: "boolean" }).notNull(),
  languagesJson: text("languages_json").notNull(), // JSON array
  shiftStart: integer("shift_start").notNull(), // hour 0-23
  shiftEnd: integer("shift_end").notNull(),
  siteId: text("site_id").references(() => sites.id),
  reliabilityAckRate: real("reliability_ack_rate").default(0.9),
  reliabilityAvgResponse: real("reliability_avg_response").default(300), // seconds
  createdAt: integer("created_at").notNull(),
});

// --- Robots ---
export const robots = sqliteTable("robots", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  siteId: text("site_id").references(() => sites.id).notNull(),
  patrolRouteJson: text("patrol_route_json").notNull(), // JSON array of zone IDs
  sensorsJson: text("sensors_json").notNull(), // JSON array of sensor types
  falsePositiveRate: real("false_positive_rate").notNull(), // 0-1
  batteryLevel: real("battery_level").default(1.0),
  createdAt: integer("created_at").notNull(),
});

// --- Events (APPEND-ONLY) ---
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // one of 12 fixed types
  siteId: text("site_id").references(() => sites.id).notNull(),
  zoneId: text("zone_id"),
  sourceType: text("source_type").notNull(), // "robot" | "guard" | "sensor" | "client"
  sourceId: text("source_id"),
  severity: integer("severity").notNull(), // 1-5
  timestamp: integer("timestamp").notNull(), // sim clock ms
  rawDataJson: text("raw_data_json"), // arbitrary payload
  groundTruthLabel: text("ground_truth_label"), // null in prod; set in sim for eval
  scenarioId: text("scenario_id"), // which scenario generated this, for eval
  createdAt: integer("created_at").notNull(), // wall clock
});

// --- Incidents ---
export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  siteId: text("site_id").references(() => sites.id).notNull(),
  zoneId: text("zone_id"),
  status: text("status").notNull(), // open | dispatched | acknowledged | on_scene | resolved | false_alarm | abandoned
  eventIds: text("event_ids_json").notNull(), // JSON array of event IDs
  priority: real("priority"), // computed score
  tier: integer("tier"), // 0-4
  confidence: real("confidence"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  resolvedAt: integer("resolved_at"),
});

// --- Decisions (APPEND-ONLY) ---
export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").references(() => incidents.id).notNull(),
  inputsJson: text("inputs_json").notNull(), // snapshot of what the scorer saw
  factorsJson: text("factors_json").notNull(), // { name, value, weight } array
  chosenTier: integer("chosen_tier").notNull(), // 0-4
  confidence: real("confidence").notNull(), // 0-1
  autonomyGate: text("autonomy_gate").notNull(), // "auto" | "propose"
  policyVersionHash: text("policy_version_hash").notNull(),
  rationaleJson: text("rationale_json"), // structured rationale
  timestamp: integer("timestamp").notNull(), // sim clock ms
  createdAt: integer("created_at").notNull(),
});

// --- Outcomes ---
export const outcomes = sqliteTable("outcomes", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").references(() => decisions.id).notNull(),
  incidentId: text("incident_id").references(() => incidents.id).notNull(),
  source: text("source").notNull(), // "guard_closeout" | "ack_telemetry" | "operator_override" | "late_signal"
  wasReal: integer("was_real", { mode: "boolean" }),
  correctTier: integer("correct_tier"), // what the tier should have been
  notes: text("notes"),
  timestamp: integer("timestamp").notNull(),
  createdAt: integer("created_at").notNull(),
});

// --- Shift Schedule ---
export const shifts = sqliteTable("shifts", {
  id: text("id").primaryKey(),
  guardId: text("guard_id").references(() => guards.id).notNull(),
  siteId: text("site_id").references(() => sites.id).notNull(),
  startTime: integer("start_time").notNull(), // sim clock ms
  endTime: integer("end_time").notNull(),
  status: text("status").notNull(), // "scheduled" | "active" | "completed" | "no_show"
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
