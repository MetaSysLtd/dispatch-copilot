import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  json,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["admin", "dispatcher"]);

export const carrierStatusEnum = pgEnum("carrier_status", [
  "active",
  "inactive",
]);

export const equipmentTypeEnum = pgEnum("equipment_type", [
  "dry_van",
  "reefer",
  "flatbed",
  "step_deck",
  "power_only",
  "other",
]);

export const channelPreferenceEnum = pgEnum("channel_preference", [
  "text",
  "call",
  "email",
]);

// ─────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("dispatcher"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// connect-pg-simple session store. Column names are fixed by the library.
export const sessions = pgTable(
  "session",
  {
    sid: text("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, withTimezone: false }).notNull(),
  },
  (table) => ({
    expireIdx: index("IDX_session_expire").on(table.expire),
  }),
);

export const carriers = pgTable("carriers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull(),
  externalId: text("external_id"),
  company: text("company").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  mcNumber: text("mc_number").notNull().unique(),
  status: carrierStatusEnum("status").notNull().default("active"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const carrierPreferences = pgTable("carrier_preferences", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  carrierId: uuid("carrier_id")
    .notNull()
    .unique()
    .references(() => carriers.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull(),
  currentCity: text("current_city"),
  currentState: text("current_state"),
  availableFrom: timestamp("available_from", { withTimezone: true }),
  preferredRegions: text("preferred_regions")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  equipmentType: equipmentTypeEnum("equipment_type"),
  weightCapLbs: integer("weight_cap_lbs"),
  minimumRpm: numeric("minimum_rpm", { precision: 10, scale: 2 }),
  facilityBlacklist: text("facility_blacklist")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  channelPreference: channelPreferenceEnum("channel_preference").default(
    "text",
  ),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────
// Zod schemas (insert / select)
// ─────────────────────────────────────────────────────────────────────

export const insertUserSchema = createInsertSchema(users).extend({
  email: z.string().email(),
  name: z.string().min(1),
});
export const selectUserSchema = createSelectSchema(users);

export const insertCarrierSchema = createInsertSchema(carriers).extend({
  company: z.string().min(1),
  contactName: z.string().min(1),
  mcNumber: z.string().min(1),
});
export const selectCarrierSchema = createSelectSchema(carriers);

export const insertCarrierPreferencesSchema = createInsertSchema(
  carrierPreferences,
).extend({
  // Accept ISO strings from the wire and coerce
  availableFrom: z.coerce.date().nullable().optional(),
  preferredRegions: z.array(z.string().length(2)).default([]),
  facilityBlacklist: z.array(z.string().min(1)).default([]),
  minimumRpm: z
    .union([z.string(), z.number()])
    .transform((v) => (v === "" ? null : String(v)))
    .nullable()
    .optional(),
  weightCapLbs: z.coerce.number().int().positive().nullable().optional(),
  currentState: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
});
export const selectCarrierPreferencesSchema =
  createSelectSchema(carrierPreferences);

// Payload coming from the preferences form (no server-side fields)
export const upsertCarrierPreferencesPayloadSchema =
  insertCarrierPreferencesSchema.omit({
    id: true,
    carrierId: true,
    orgId: true,
    updatedAt: true,
  });

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type Carrier = typeof carriers.$inferSelect;
export type InsertCarrier = typeof carriers.$inferInsert;

export type CarrierPreferences = typeof carrierPreferences.$inferSelect;
export type InsertCarrierPreferences = typeof carrierPreferences.$inferInsert;

export type CarrierWithPreferences = Carrier & {
  preferences: CarrierPreferences | null;
};

export type UpsertCarrierPreferencesPayload = z.infer<
  typeof upsertCarrierPreferencesPayloadSchema
>;

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

export const OPS_TZ = "America/New_York" as const;

// Public-safe shape (no password hash) for auth responses
export const publicUserSchema = selectUserSchema.omit({ passwordHash: true });
export type PublicUser = z.infer<typeof publicUserSchema>;

// ─────────────────────────────────────────────────────────────────────
// Week 2 — load intelligence shared contracts
// ─────────────────────────────────────────────────────────────────────

// Deterministic scoring breakdown — persisted to dat_candidates.scoreReasons
// and rendered in the Load Hunter UI. Keep keys stable; the UI maps them.
export interface ScoreReasons {
  rpm_vs_median: string | null;
  rpm_vs_minimum: string;
  equipment_match: string;
  weight_fit: string;
  direction_match: string;
  broker_history: string;
  deadhead_estimate: string;
}

// Structured load extracted from pasted DAT text by the parser.
export interface ParsedLoad {
  originCity: string | null;
  originState: string | null;
  destCity: string | null;
  destState: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  loadRateDollars: number | null;
  distanceMiles: number | null;
  weightLbs: number | null;
  equipmentType: string | null;
  brokerName: string | null;
  brokerContact: string | null;
  brokerPhone: string | null;
  rpm: number | null;
}

// ─────────────────────────────────────────────────────────────────────
// Week 2 — tables
// ─────────────────────────────────────────────────────────────────────

export const datCandidateStatusEnum = pgEnum("dat_candidate_status", [
  "pending",
  "drafted",
  "sent",
  "booked",
  "rejected",
]);

export const brokerScores = pgTable(
  "broker_scores",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id").notNull(),
    brokerName: text("broker_name").notNull(),
    brokerNameRaw: text("broker_name_raw").notNull(),
    totalLoads: integer("total_loads").default(0),
    avgLoadRate: numeric("avg_load_rate", { precision: 10, scale: 2 }),
    onTimePaymentRate: numeric("on_time_payment_rate", {
      precision: 5,
      scale: 2,
    }),
    avgDaysToPayment: numeric("avg_days_to_payment", {
      precision: 5,
      scale: 1,
    }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgBrokerUnique: unique("broker_scores_org_broker_unique").on(
      t.orgId,
      t.brokerName,
    ),
  }),
);

export const laneRates = pgTable(
  "lane_rates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id").notNull(),
    originCity: text("origin_city").notNull(),
    originState: text("origin_state").notNull(),
    destCity: text("dest_city").notNull(),
    destState: text("dest_state").notNull(),
    medianRpm: numeric("median_rpm", { precision: 10, scale: 4 }),
    avgRpm: numeric("avg_rpm", { precision: 10, scale: 4 }),
    minRpm: numeric("min_rpm", { precision: 10, scale: 4 }),
    maxRpm: numeric("max_rpm", { precision: 10, scale: 4 }),
    sampleCount: integer("sample_count").default(0),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    laneUnique: unique("lane_rates_org_lane_unique").on(
      t.orgId,
      t.originCity,
      t.originState,
      t.destCity,
      t.destState,
    ),
  }),
);

export const datCandidates = pgTable("dat_candidates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull(),
  carrierId: uuid("carrier_id").references(() => carriers.id, {
    onDelete: "cascade",
  }),
  rawText: text("raw_text"),
  originCity: text("origin_city"),
  originState: text("origin_state"),
  destCity: text("dest_city"),
  destState: text("dest_state"),
  pickupDate: timestamp("pickup_date", { withTimezone: true }),
  deliveryDate: timestamp("delivery_date", { withTimezone: true }),
  loadRateDollars: numeric("load_rate_dollars", { precision: 10, scale: 2 }),
  distanceMiles: integer("distance_miles"),
  weightLbs: integer("weight_lbs"),
  equipmentType: text("equipment_type"),
  brokerName: text("broker_name"),
  brokerContact: text("broker_contact"),
  brokerPhone: text("broker_phone"),
  rpm: numeric("rpm", { precision: 10, scale: 4 }),
  score: integer("score"),
  scoreReasons: jsonb("score_reasons").$type<ScoreReasons>(),
  status: datCandidateStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────
// Week 2 — Zod schemas + types
// ─────────────────────────────────────────────────────────────────────

export const insertBrokerScoreSchema = createInsertSchema(brokerScores);
export const selectBrokerScoreSchema = createSelectSchema(brokerScores);

export const insertLaneRateSchema = createInsertSchema(laneRates);
export const selectLaneRateSchema = createSelectSchema(laneRates);

export const insertDatCandidateSchema = createInsertSchema(datCandidates);
export const selectDatCandidateSchema = createSelectSchema(datCandidates);

export const datCandidateStatusValues = [
  "pending",
  "drafted",
  "sent",
  "booked",
  "rejected",
] as const;
export type DatCandidateStatus = (typeof datCandidateStatusValues)[number];

export type BrokerScore = typeof brokerScores.$inferSelect;
export type InsertBrokerScore = typeof brokerScores.$inferInsert;

export type LaneRate = typeof laneRates.$inferSelect;
export type InsertLaneRate = typeof laneRates.$inferInsert;

export type DatCandidate = typeof datCandidates.$inferSelect;
export type InsertDatCandidate = typeof datCandidates.$inferInsert;
