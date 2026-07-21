import { eq } from "drizzle-orm";
import { getDb } from "./connection";
import {
  events,
  decisions,
  incidents,
  outcomes,
  sites,
  guards,
  robots,
  shifts,
  type Event,
  type Decision,
  type Incident,
  type Outcome,
} from "./schema";

// ---- Append-only error ----
export class AppendOnlyViolation extends Error {
  constructor(table: string, operation: string) {
    super(`${table} is append-only: ${operation} is not allowed`);
    this.name = "AppendOnlyViolation";
  }
}

// ---- Events (APPEND-ONLY) ----
export const eventRepo = {
  insert(event: typeof events.$inferInsert) {
    return getDb().insert(events).values(event).run();
  },
  insertMany(rows: (typeof events.$inferInsert)[]) {
    if (rows.length === 0) return;
    return getDb().insert(events).values(rows).run();
  },
  getById(id: string): Event | undefined {
    return getDb().select().from(events).where(eq(events.id, id)).get();
  },
  getAll(): Event[] {
    return getDb().select().from(events).all();
  },
  getBySite(siteId: string): Event[] {
    return getDb().select().from(events).where(eq(events.siteId, siteId)).all();
  },
  getByScenario(scenarioId: string): Event[] {
    return getDb().select().from(events).where(eq(events.scenarioId, scenarioId)).all();
  },
  // Forbidden operations
  update(): never {
    throw new AppendOnlyViolation("events", "update");
  },
  delete(): never {
    throw new AppendOnlyViolation("events", "delete");
  },
};

// ---- Decisions (APPEND-ONLY) ----
export const decisionRepo = {
  insert(decision: typeof decisions.$inferInsert) {
    return getDb().insert(decisions).values(decision).run();
  },
  insertMany(rows: (typeof decisions.$inferInsert)[]) {
    if (rows.length === 0) return;
    return getDb().insert(decisions).values(rows).run();
  },
  getById(id: string): Decision | undefined {
    return getDb().select().from(decisions).where(eq(decisions.id, id)).get();
  },
  getAll(): Decision[] {
    return getDb().select().from(decisions).all();
  },
  getByIncident(incidentId: string): Decision[] {
    return getDb()
      .select()
      .from(decisions)
      .where(eq(decisions.incidentId, incidentId))
      .all();
  },
  // Forbidden operations
  update(): never {
    throw new AppendOnlyViolation("decisions", "update");
  },
  delete(): never {
    throw new AppendOnlyViolation("decisions", "delete");
  },
};

// ---- Incidents (mutable — status changes) ----
export const incidentRepo = {
  insert(incident: typeof incidents.$inferInsert) {
    return getDb().insert(incidents).values(incident).run();
  },
  getById(id: string): Incident | undefined {
    return getDb().select().from(incidents).where(eq(incidents.id, id)).get();
  },
  getAll(): Incident[] {
    return getDb().select().from(incidents).all();
  },
  update(id: string, data: Partial<typeof incidents.$inferInsert>) {
    return getDb().update(incidents).set(data).where(eq(incidents.id, id)).run();
  },
};

// ---- Outcomes ----
export const outcomeRepo = {
  insert(outcome: typeof outcomes.$inferInsert) {
    return getDb().insert(outcomes).values(outcome).run();
  },
  getByDecision(decisionId: string): Outcome[] {
    return getDb()
      .select()
      .from(outcomes)
      .where(eq(outcomes.decisionId, decisionId))
      .all();
  },
  getByIncident(incidentId: string): Outcome[] {
    return getDb()
      .select()
      .from(outcomes)
      .where(eq(outcomes.incidentId, incidentId))
      .all();
  },
  getAll(): Outcome[] {
    return getDb().select().from(outcomes).all();
  },
};

// ---- Sites ----
export const siteRepo = {
  insert(site: typeof sites.$inferInsert) {
    return getDb().insert(sites).values(site).run();
  },
  insertMany(rows: (typeof sites.$inferInsert)[]) {
    if (rows.length === 0) return;
    return getDb().insert(sites).values(rows).run();
  },
  getById(id: string) {
    return getDb().select().from(sites).where(eq(sites.id, id)).get();
  },
  getAll() {
    return getDb().select().from(sites).all();
  },
};

// ---- Guards ----
export const guardRepo = {
  insert(guard: typeof guards.$inferInsert) {
    return getDb().insert(guards).values(guard).run();
  },
  insertMany(rows: (typeof guards.$inferInsert)[]) {
    if (rows.length === 0) return;
    return getDb().insert(guards).values(rows).run();
  },
  getById(id: string) {
    return getDb().select().from(guards).where(eq(guards.id, id)).get();
  },
  getAll() {
    return getDb().select().from(guards).all();
  },
  getBySite(siteId: string) {
    return getDb().select().from(guards).where(eq(guards.siteId, siteId)).all();
  },
};

// ---- Robots ----
export const robotRepo = {
  insert(robot: typeof robots.$inferInsert) {
    return getDb().insert(robots).values(robot).run();
  },
  insertMany(rows: (typeof robots.$inferInsert)[]) {
    if (rows.length === 0) return;
    return getDb().insert(robots).values(rows).run();
  },
  getById(id: string) {
    return getDb().select().from(robots).where(eq(robots.id, id)).get();
  },
  getAll() {
    return getDb().select().from(robots).all();
  },
  getBySite(siteId: string) {
    return getDb().select().from(robots).where(eq(robots.siteId, siteId)).all();
  },
};

// ---- Shifts ----
export const shiftRepo = {
  insert(shift: typeof shifts.$inferInsert) {
    return getDb().insert(shifts).values(shift).run();
  },
  insertMany(rows: (typeof shifts.$inferInsert)[]) {
    if (rows.length === 0) return;
    return getDb().insert(shifts).values(rows).run();
  },
  getAll() {
    return getDb().select().from(shifts).all();
  },
  getBySite(siteId: string) {
    return getDb().select().from(shifts).where(eq(shifts.siteId, siteId)).all();
  },
  update(id: string, data: Partial<typeof shifts.$inferInsert>) {
    return getDb().update(shifts).set(data).where(eq(shifts.id, id)).run();
  },
};
