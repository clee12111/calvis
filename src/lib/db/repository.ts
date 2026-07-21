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
  async insert(event: typeof events.$inferInsert) {
    const db = await getDb();
    return db.insert(events).values(event);
  },
  async insertMany(rows: (typeof events.$inferInsert)[]) {
    if (rows.length === 0) return;
    const db = await getDb();
    for (const row of rows) {
      await db.insert(events).values(row);
    }
  },
  async getById(id: string): Promise<Event | undefined> {
    const db = await getDb();
    const rows = await db.select().from(events).where(eq(events.id, id));
    return rows[0];
  },
  async getAll(): Promise<Event[]> {
    const db = await getDb();
    return db.select().from(events);
  },
  async getBySite(siteId: string): Promise<Event[]> {
    const db = await getDb();
    return db.select().from(events).where(eq(events.siteId, siteId));
  },
  async getByScenario(scenarioId: string): Promise<Event[]> {
    const db = await getDb();
    return db.select().from(events).where(eq(events.scenarioId, scenarioId));
  },
  update(): never {
    throw new AppendOnlyViolation("events", "update");
  },
  delete(): never {
    throw new AppendOnlyViolation("events", "delete");
  },
};

// ---- Decisions (APPEND-ONLY) ----
export const decisionRepo = {
  async insert(decision: typeof decisions.$inferInsert) {
    const db = await getDb();
    return db.insert(decisions).values(decision);
  },
  async insertMany(rows: (typeof decisions.$inferInsert)[]) {
    if (rows.length === 0) return;
    const db = await getDb();
    for (const row of rows) {
      await db.insert(decisions).values(row);
    }
  },
  async getById(id: string): Promise<Decision | undefined> {
    const db = await getDb();
    const rows = await db.select().from(decisions).where(eq(decisions.id, id));
    return rows[0];
  },
  async getAll(): Promise<Decision[]> {
    const db = await getDb();
    return db.select().from(decisions);
  },
  async getByIncident(incidentId: string): Promise<Decision[]> {
    const db = await getDb();
    return db.select().from(decisions).where(eq(decisions.incidentId, incidentId));
  },
  update(): never {
    throw new AppendOnlyViolation("decisions", "update");
  },
  delete(): never {
    throw new AppendOnlyViolation("decisions", "delete");
  },
};

// ---- Incidents (mutable — status changes) ----
export const incidentRepo = {
  async insert(incident: typeof incidents.$inferInsert) {
    const db = await getDb();
    return db.insert(incidents).values(incident);
  },
  async getById(id: string): Promise<Incident | undefined> {
    const db = await getDb();
    const rows = await db.select().from(incidents).where(eq(incidents.id, id));
    return rows[0];
  },
  async getAll(): Promise<Incident[]> {
    const db = await getDb();
    return db.select().from(incidents);
  },
  async update(id: string, data: Partial<typeof incidents.$inferInsert>) {
    const db = await getDb();
    return db.update(incidents).set(data).where(eq(incidents.id, id));
  },
};

// ---- Outcomes ----
export const outcomeRepo = {
  async insert(outcome: typeof outcomes.$inferInsert) {
    const db = await getDb();
    return db.insert(outcomes).values(outcome);
  },
  async getByDecision(decisionId: string): Promise<Outcome[]> {
    const db = await getDb();
    return db.select().from(outcomes).where(eq(outcomes.decisionId, decisionId));
  },
  async getByIncident(incidentId: string): Promise<Outcome[]> {
    const db = await getDb();
    return db.select().from(outcomes).where(eq(outcomes.incidentId, incidentId));
  },
  async getAll(): Promise<Outcome[]> {
    const db = await getDb();
    return db.select().from(outcomes);
  },
};

// ---- Sites ----
export const siteRepo = {
  async insert(site: typeof sites.$inferInsert) {
    const db = await getDb();
    return db.insert(sites).values(site);
  },
  async insertMany(rows: (typeof sites.$inferInsert)[]) {
    if (rows.length === 0) return;
    const db = await getDb();
    for (const row of rows) await db.insert(sites).values(row);
  },
  async getById(id: string) {
    const db = await getDb();
    const rows = await db.select().from(sites).where(eq(sites.id, id));
    return rows[0];
  },
  async getAll() {
    const db = await getDb();
    return db.select().from(sites);
  },
};

// ---- Guards ----
export const guardRepo = {
  async insert(guard: typeof guards.$inferInsert) {
    const db = await getDb();
    return db.insert(guards).values(guard);
  },
  async insertMany(rows: (typeof guards.$inferInsert)[]) {
    if (rows.length === 0) return;
    const db = await getDb();
    for (const row of rows) await db.insert(guards).values(row);
  },
  async getById(id: string) {
    const db = await getDb();
    const rows = await db.select().from(guards).where(eq(guards.id, id));
    return rows[0];
  },
  async getAll() {
    const db = await getDb();
    return db.select().from(guards);
  },
  async getBySite(siteId: string) {
    const db = await getDb();
    return db.select().from(guards).where(eq(guards.siteId, siteId));
  },
};

// ---- Robots ----
export const robotRepo = {
  async insert(robot: typeof robots.$inferInsert) {
    const db = await getDb();
    return db.insert(robots).values(robot);
  },
  async insertMany(rows: (typeof robots.$inferInsert)[]) {
    if (rows.length === 0) return;
    const db = await getDb();
    for (const row of rows) await db.insert(robots).values(row);
  },
  async getById(id: string) {
    const db = await getDb();
    const rows = await db.select().from(robots).where(eq(robots.id, id));
    return rows[0];
  },
  async getAll() {
    const db = await getDb();
    return db.select().from(robots);
  },
  async getBySite(siteId: string) {
    const db = await getDb();
    return db.select().from(robots).where(eq(robots.siteId, siteId));
  },
};

// ---- Shifts ----
export const shiftRepo = {
  async insert(shift: typeof shifts.$inferInsert) {
    const db = await getDb();
    return db.insert(shifts).values(shift);
  },
  async insertMany(rows: (typeof shifts.$inferInsert)[]) {
    if (rows.length === 0) return;
    const db = await getDb();
    for (const row of rows) await db.insert(shifts).values(row);
  },
  async getAll() {
    const db = await getDb();
    return db.select().from(shifts);
  },
  async getBySite(siteId: string) {
    const db = await getDb();
    return db.select().from(shifts).where(eq(shifts.siteId, siteId));
  },
  async update(id: string, data: Partial<typeof shifts.$inferInsert>) {
    const db = await getDb();
    return db.update(shifts).set(data).where(eq(shifts.id, id));
  },
};
