import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db.js";
import {
  brokerScores,
  laneRates,
  type InsertBrokerScore,
  type InsertLaneRate,
} from "../shared/schema.js";
import {
  normalizeBrokerName,
  isUnusableBroker,
} from "../server/agents/load-hunter/normalize.js";
import { DEFAULT_ORG_ID } from "./_org.js";

interface CsvRow {
  CARRIER?: string;
  DISPATCHER?: string;
  PICKUP?: string;
  DELIVERY?: string;
  Route?: string;
  Broker?: string;
  "LOAD RATE"?: string;
  "OUR FEE"?: string;
  Status?: string;
  Created?: string;
  BOOKED?: string;
  Actions?: string;
}

function parseMoney(input: string | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(input: string | undefined): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface ParsedRoute {
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
}

// Route format: "City, ST → City, ST" (also tolerates -> and plain -).
function parseRoute(route: string | undefined): ParsedRoute | null {
  if (!route) return null;
  const parts = route.split(/→|->|—|→/);
  if (parts.length !== 2) return null;

  const parseEndpoint = (s: string): { city: string; state: string } | null => {
    const [cityRaw, stateRaw] = s.split(",");
    if (!cityRaw || !stateRaw) return null;
    const city = cityRaw.trim();
    const state = stateRaw.trim().toUpperCase();
    if (!city || !/^[A-Z]{2}$/.test(state)) return null;
    return { city, state };
  };

  const origin = parseEndpoint(parts[0]);
  const dest = parseEndpoint(parts[1]);
  if (!origin || !dest) return null;
  return {
    originCity: origin.city,
    originState: origin.state,
    destCity: dest.city,
    destState: dest.state,
  };
}

interface BrokerAgg {
  brokerNameRaw: string;
  totalLoads: number;
  rateSum: number;
  rateCount: number;
  lastSeenAt: Date | null;
}

interface LaneAgg extends ParsedRoute {
  sampleCount: number;
}

async function main() {
  const csvArg = process.argv[2] ?? "scripts/loads.csv";
  const csvPath = path.isAbsolute(csvArg)
    ? csvArg
    : path.resolve(process.cwd(), csvArg);

  if (!fs.existsSync(csvPath)) {
    console.error(`[backfill] CSV not found at ${csvPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as CsvRow[];

  console.log(`[backfill] read ${rows.length} rows from ${csvPath}`);

  // ── Aggregate in memory ──────────────────────────────────────────────
  const brokers = new Map<string, BrokerAgg>();
  const lanes = new Map<string, LaneAgg>();

  let brokerProcessed = 0;
  let brokerSkipped = 0;
  let laneProcessed = 0;
  let laneSkipped = 0;

  for (const row of rows) {
    // Brokers
    const brokerRaw = row.Broker?.trim();
    if (isUnusableBroker(brokerRaw)) {
      brokerSkipped++;
    } else {
      const key = normalizeBrokerName(brokerRaw);
      if (!key) {
        brokerSkipped++;
      } else {
        brokerProcessed++;
        const rate = parseMoney(row["LOAD RATE"]);
        const booked = parseDate(row.BOOKED);
        const existing = brokers.get(key);
        if (existing) {
          existing.totalLoads += 1;
          if (rate != null) {
            existing.rateSum += rate;
            existing.rateCount += 1;
          }
          if (booked && (!existing.lastSeenAt || booked > existing.lastSeenAt)) {
            existing.lastSeenAt = booked;
          }
        } else {
          brokers.set(key, {
            brokerNameRaw: brokerRaw as string,
            totalLoads: 1,
            rateSum: rate ?? 0,
            rateCount: rate != null ? 1 : 0,
            lastSeenAt: booked,
          });
        }
      }
    }

    // Lanes
    const route = parseRoute(row.Route);
    if (!route) {
      laneSkipped++;
    } else {
      laneProcessed++;
      const laneKey = `${route.originCity}|${route.originState}|${route.destCity}|${route.destState}`.toLowerCase();
      const existing = lanes.get(laneKey);
      if (existing) {
        existing.sampleCount += 1;
      } else {
        lanes.set(laneKey, { ...route, sampleCount: 1 });
      }
    }
  }

  // ── Upsert brokers ───────────────────────────────────────────────────
  let brokerInserted = 0;
  let brokerUpdated = 0;
  for (const [normalized, agg] of brokers) {
    const avgLoadRate =
      agg.rateCount > 0 ? (agg.rateSum / agg.rateCount).toFixed(2) : null;
    const values: InsertBrokerScore = {
      orgId: DEFAULT_ORG_ID,
      brokerName: normalized,
      brokerNameRaw: agg.brokerNameRaw,
      totalLoads: agg.totalLoads,
      avgLoadRate,
      onTimePaymentRate: "85.0", // default — no payment data in this export
      avgDaysToPayment: "30.0", // default — no payment data in this export
      lastSeenAt: agg.lastSeenAt,
      updatedAt: new Date(),
    };
    const result = await db
      .insert(brokerScores)
      .values(values)
      .onConflictDoUpdate({
        target: [brokerScores.orgId, brokerScores.brokerName],
        set: {
          brokerNameRaw: values.brokerNameRaw,
          totalLoads: values.totalLoads,
          avgLoadRate: values.avgLoadRate,
          lastSeenAt: values.lastSeenAt,
          updatedAt: new Date(),
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (result[0]?.inserted) brokerInserted++;
    else brokerUpdated++;
  }

  // ── Upsert lanes ─────────────────────────────────────────────────────
  let laneInserted = 0;
  let laneUpdated = 0;
  for (const agg of lanes.values()) {
    const values: InsertLaneRate = {
      orgId: DEFAULT_ORG_ID,
      originCity: agg.originCity,
      originState: agg.originState,
      destCity: agg.destCity,
      destState: agg.destState,
      medianRpm: null, // no miles in this export → cannot compute RPM yet
      avgRpm: null,
      minRpm: null,
      maxRpm: null,
      sampleCount: agg.sampleCount,
      lastUpdatedAt: new Date(),
    };
    const result = await db
      .insert(laneRates)
      .values(values)
      .onConflictDoUpdate({
        target: [
          laneRates.orgId,
          laneRates.originCity,
          laneRates.originState,
          laneRates.destCity,
          laneRates.destState,
        ],
        set: {
          sampleCount: values.sampleCount,
          lastUpdatedAt: new Date(),
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (result[0]?.inserted) laneInserted++;
    else laneUpdated++;
  }

  console.log(
    `[brokers] processed ${brokerProcessed}, inserted ${brokerInserted}, updated ${brokerUpdated}, skipped ${brokerSkipped}`,
  );
  console.log(
    `[lanes] processed ${laneProcessed}, inserted ${laneInserted}, updated ${laneUpdated}, skipped ${laneSkipped}`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  pool.end().finally(() => process.exit(1));
});
