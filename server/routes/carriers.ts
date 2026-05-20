import { Router, type Request, type Response, type NextFunction } from "express";
import { asc, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  carriers,
  carrierPreferences,
  upsertCarrierPreferencesPayloadSchema,
  type CarrierWithPreferences,
} from "../../shared/schema.js";
import { broadcast } from "../ws.js";

export const carriersRouter = Router();

carriersRouter.get(
  "/",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db
        .select()
        .from(carriers)
        .leftJoin(
          carrierPreferences,
          eq(carrierPreferences.carrierId, carriers.id),
        )
        .orderBy(asc(carriers.company));

      const result: CarrierWithPreferences[] = rows.map((row) => ({
        ...row.carriers,
        preferences: row.carrier_preferences ?? null,
      }));
      res.json({ carriers: result });
    } catch (err) {
      next(err);
    }
  },
);

carriersRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const [carrier] = await db
        .select()
        .from(carriers)
        .where(eq(carriers.id, id))
        .limit(1);

      if (!carrier) {
        res.status(404).json({ error: "Carrier not found" });
        return;
      }

      const [prefs] = await db
        .select()
        .from(carrierPreferences)
        .where(eq(carrierPreferences.carrierId, id))
        .limit(1);

      const payload: CarrierWithPreferences = {
        ...carrier,
        preferences: prefs ?? null,
      };
      res.json({ carrier: payload });
    } catch (err) {
      next(err);
    }
  },
);

carriersRouter.put(
  "/:id/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const carrierId = req.params.id;
      const parsed = upsertCarrierPreferencesPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
        return;
      }

      const [carrier] = await db
        .select({ id: carriers.id, orgId: carriers.orgId })
        .from(carriers)
        .where(eq(carriers.id, carrierId))
        .limit(1);
      if (!carrier) {
        res.status(404).json({ error: "Carrier not found" });
        return;
      }

      const values = {
        ...parsed.data,
        carrierId,
        orgId: carrier.orgId,
        updatedAt: new Date(),
      };

      const [saved] = await db
        .insert(carrierPreferences)
        .values(values)
        .onConflictDoUpdate({
          target: carrierPreferences.carrierId,
          set: {
            currentCity: values.currentCity ?? null,
            currentState: values.currentState ?? null,
            availableFrom: values.availableFrom ?? null,
            preferredRegions: values.preferredRegions ?? [],
            equipmentType: values.equipmentType ?? null,
            weightCapLbs: values.weightCapLbs ?? null,
            minimumRpm: values.minimumRpm ?? null,
            facilityBlacklist: values.facilityBlacklist ?? [],
            channelPreference: values.channelPreference ?? "text",
            notes: values.notes ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();

      broadcast("carrier_preferences_updated", {
        carrierId,
        preferences: saved,
      });

      res.json({ preferences: saved });
    } catch (err) {
      next(err);
    }
  },
);
