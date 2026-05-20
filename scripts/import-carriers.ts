import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { db, pool } from "../server/db.js";
import { carriers, type InsertCarrier } from "../shared/schema.js";
import { DEFAULT_ORG_ID } from "./_org.js";

interface CsvRow {
  Company?: string;
  "Contact Name"?: string;
  Owner?: string;
  SDR?: string;
  Email?: string;
  Phone?: string;
  "MC Number"?: string;
  Status?: string;
  Onboarded?: string;
  "Active Since"?: string;
  Actions?: string;
}

function parseDate(input: string | undefined): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function main() {
  const csvArg = process.argv[2] ?? "scripts/carriers.csv";
  const csvPath = path.isAbsolute(csvArg)
    ? csvArg
    : path.resolve(process.cwd(), csvArg);

  if (!fs.existsSync(csvPath)) {
    console.error(`[import-carriers] CSV not found at ${csvPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  console.log(`[import-carriers] read ${rows.length} rows from ${csvPath}`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const mc = row["MC Number"]?.trim();
    const company = row.Company?.trim();
    const contact = row["Contact Name"]?.trim();

    if (!mc) {
      skipped++;
      console.log(`[skip] no MC number for "${company ?? "unknown"}"`);
      continue;
    }
    if (!company || !contact) {
      skipped++;
      console.log(`[skip] missing company/contact for MC ${mc}`);
      continue;
    }
    if (seen.has(mc)) {
      skipped++;
      console.log(`[skip] duplicate MC ${mc} in CSV`);
      continue;
    }
    seen.add(mc);

    const values: InsertCarrier = {
      orgId: DEFAULT_ORG_ID,
      externalId: null,
      company,
      contactName: contact,
      email: row.Email?.trim() || null,
      phone: row.Phone?.trim() || null,
      mcNumber: mc,
      status:
        row.Status?.trim().toLowerCase() === "active" ? "active" : "inactive",
      onboardedAt: parseDate(row["Active Since"]),
      notes: null,
    };

    try {
      const result = await db
        .insert(carriers)
        .values(values)
        .onConflictDoNothing({ target: carriers.mcNumber })
        .returning({ id: carriers.id });

      if (result.length === 0) {
        skipped++;
        console.log(`[skip] MC ${mc} already in database`);
      } else {
        inserted++;
        console.log(`[ok]  ${company} (MC ${mc})`);
      }
    } catch (err) {
      errors++;
      console.error(`[err] ${company} (MC ${mc}):`, (err as Error).message);
    }
  }

  console.log(
    `\n[import-carriers] done: inserted ${inserted}, skipped ${skipped}, errors ${errors}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[import-carriers] fatal:", err);
  pool.end().finally(() => process.exit(1));
});
