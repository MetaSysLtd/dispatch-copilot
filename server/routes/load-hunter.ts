import { Router, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { db } from "../db.js";
import {
  carriers,
  carrierPreferences,
  brokerScores,
  laneRates,
  datCandidates,
  datCandidateStatusValues,
  OPS_TZ,
  type CarrierWithPreferences,
  type LaneRate,
  type BrokerScore,
} from "../../shared/schema.js";
import { parseLoadText } from "../agents/load-hunter/parser.js";
import { scoreLoad } from "../agents/load-hunter/scorer.js";
import { normalizeBrokerName, isUnusableBroker } from "../agents/load-hunter/normalize.js";
import { broadcast } from "../ws.js";

export const loadHunterRouter = Router();

const parseBodySchema = z.object({
  rawText: z.string().min(1, "rawText is required"),
  carrierId: z.string().uuid(),
});

// Interpret a parser date string in OPS_TZ. If it already carries an explicit
// offset (…Z or ±HH:MM) trust it; otherwise treat the wall-clock time as ET.
function toOpsDate(value: string | null): Date | null {
  if (!value) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  const d = hasOffset ? new Date(value) : fromZonedTime(value, OPS_TZ);
  return Number.isNaN(d.getTime()) ? null : d;
}

loadHunterRouter.post(
  "/parse",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = parseBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          error: "Invalid payload",
          details: parsedBody.error.flatten(),
        });
        return;
      }
      const { rawText, carrierId } = parsedBody.data;

      // Carrier + preferences (one query, left join).
      const [carrierRow] = await db
        .select()
        .from(carriers)
        .leftJoin(
          carrierPreferences,
          eq(carrierPreferences.carrierId, carriers.id),
        )
        .where(eq(carriers.id, carrierId))
        .limit(1);

      if (!carrierRow) {
        res.status(404).json({ error: "Carrier not found" });
        return;
      }
      const carrier: CarrierWithPreferences = {
        ...carrierRow.carriers,
        preferences: carrierRow.carrier_preferences ?? null,
      };

      // One Claude call to structure the pasted text.
      const parsed = await parseLoadText(rawText);

      // Lane rate for this origin → dest, if we have history.
      let laneRate: LaneRate | null = null;
      if (
        parsed.originCity &&
        parsed.originState &&
        parsed.destCity &&
        parsed.destState
      ) {
        const [lr] = await db
          .select()
          .from(laneRates)
          .where(
            and(
              eq(laneRates.orgId, carrier.orgId),
              eq(laneRates.originCity, parsed.originCity),
              eq(laneRates.originState, parsed.originState),
              eq(laneRates.destCity, parsed.destCity),
              eq(laneRates.destState, parsed.destState),
            ),
          )
          .limit(1);
        laneRate = lr ?? null;
      }

      // Broker score by normalized name.
      let brokerScore: BrokerScore | null = null;
      if (parsed.brokerName && !isUnusableBroker(parsed.brokerName)) {
        const normalized = normalizeBrokerName(parsed.brokerName);
        if (normalized) {
          const [bs] = await db
            .select()
            .from(brokerScores)
            .where(
              and(
                eq(brokerScores.orgId, carrier.orgId),
                eq(brokerScores.brokerName, normalized),
              ),
            )
            .limit(1);
          brokerScore = bs ?? null;
        }
      }

      const { score, reasons, points } = scoreLoad(
        {
          rpm: parsed.rpm,
          equipmentType: parsed.equipmentType,
          weightLbs: parsed.weightLbs,
          originCity: parsed.originCity,
          originState: parsed.originState,
          destState: parsed.destState,
        },
        carrier.preferences,
        laneRate,
        brokerScore,
      );

      const [candidate] = await db
        .insert(datCandidates)
        .values({
          orgId: carrier.orgId,
          carrierId,
          rawText,
          originCity: parsed.originCity,
          originState: parsed.originState,
          destCity: parsed.destCity,
          destState: parsed.destState,
          pickupDate: toOpsDate(parsed.pickupDate),
          deliveryDate: toOpsDate(parsed.deliveryDate),
          loadRateDollars:
            parsed.loadRateDollars != null
              ? String(parsed.loadRateDollars)
              : null,
          distanceMiles: parsed.distanceMiles,
          weightLbs: parsed.weightLbs,
          equipmentType: parsed.equipmentType,
          brokerName: parsed.brokerName,
          brokerContact: parsed.brokerContact,
          brokerPhone: parsed.brokerPhone,
          rpm: parsed.rpm != null ? String(parsed.rpm) : null,
          score,
          scoreReasons: reasons,
          status: "pending",
        })
        .returning();

      res.json({
        candidateId: candidate.id,
        parsed,
        score,
        reasons,
        points,
        carrier,
        laneRate,
        brokerScore,
      });
    } catch (err) {
      next(err);
    }
  },
);

const candidatesQuerySchema = z.object({
  carrierId: z.string().uuid().optional(),
  status: z.enum(datCandidateStatusValues).optional(),
});

loadHunterRouter.get(
  "/candidates",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedQuery = candidatesQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({
          error: "Invalid query",
          details: parsedQuery.error.flatten(),
        });
        return;
      }
      const { carrierId, status } = parsedQuery.data;

      const conditions = [];
      if (carrierId) conditions.push(eq(datCandidates.carrierId, carrierId));
      if (status) conditions.push(eq(datCandidates.status, status));

      const rows = await db
        .select()
        .from(datCandidates)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(datCandidates.score), desc(datCandidates.createdAt))
        .limit(50);

      res.json({ candidates: rows });
    } catch (err) {
      next(err);
    }
  },
);

const statusBodySchema = z.object({
  status: z.enum(["drafted", "sent", "booked", "rejected"]),
});

loadHunterRouter.patch(
  "/candidates/:id/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsedBody = statusBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({
          error: "Invalid payload",
          details: parsedBody.error.flatten(),
        });
        return;
      }
      const { status } = parsedBody.data;
      const id = req.params.id;

      const [updated] = await db
        .update(datCandidates)
        .set({ status, updatedAt: new Date() })
        .where(eq(datCandidates.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Candidate not found" });
        return;
      }

      broadcast("candidate_status_updated", { candidateId: id, status });
      res.json({ candidate: updated });
    } catch (err) {
      next(err);
    }
  },
);
