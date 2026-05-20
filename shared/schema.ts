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
  index,
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
