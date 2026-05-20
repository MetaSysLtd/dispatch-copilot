import "dotenv/config";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db.js";
import { users, type InsertUser } from "../shared/schema.js";
import { DEFAULT_ORG_ID } from "./_org.js";

const SALT_ROUNDS = 12;
const DEFAULT_PASSWORD = "Dispatch2026!";

interface SeedUser {
  email: string;
  name: string;
  role: "admin" | "dispatcher";
}

const seedUsers: SeedUser[] = [
  { email: "brandon@metasysltd.com", name: "Brandon Scott", role: "dispatcher" },
  { email: "alan@metasysltd.com", name: "Alan Reese", role: "dispatcher" },
  { email: "mike@metasysltd.com", name: "Mike Brook", role: "dispatcher" },
  { email: "austin@metasysltd.com", name: "Austin Nova", role: "dispatcher" },
  { email: "admin@metasysltd.com", name: "Admin", role: "admin" },
];

async function main() {
  let created = 0;
  let skipped = 0;
  let errors = 0;

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  for (const u of seedUsers) {
    const email = u.email.toLowerCase();
    try {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        skipped++;
        console.log(`[skip] ${email} already exists`);
        continue;
      }

      const values: InsertUser = {
        orgId: DEFAULT_ORG_ID,
        email,
        name: u.name,
        role: u.role,
        passwordHash,
      };
      await db.insert(users).values(values);
      created++;
      console.log(`[ok]  ${email} (${u.role})`);
    } catch (err) {
      errors++;
      console.error(`[err] ${email}:`, (err as Error).message);
    }
  }

  console.log(
    `\n[seed-users] done: created ${created}, skipped ${skipped}, errors ${errors}`,
  );
  console.log(`[seed-users] default password: ${DEFAULT_PASSWORD}`);
  await pool.end();
}

main().catch((err) => {
  console.error("[seed-users] fatal:", err);
  pool.end().finally(() => process.exit(1));
});
