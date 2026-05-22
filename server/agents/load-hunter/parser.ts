import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { computeRpm } from "./scorer.js";
import type { ParsedLoad } from "../../../shared/schema.js";

export type { ParsedLoad };

// User explicitly chose claude-sonnet-4-5 for this extraction task (fast,
// cheap). Sonnet 4.6 exists if a future upgrade is wanted.
const MODEL = "claude-sonnet-4-5";

const EQUIPMENT_VALUES = [
  "dry_van",
  "reefer",
  "flatbed",
  "step_deck",
  "power_only",
  "other",
] as const;

// Validate the model's JSON before we trust it. Everything is nullable —
// messy DAT pastes routinely omit fields.
const parsedSchema = z.object({
  originCity: z.string().min(1).nullable(),
  originState: z.string().length(2).nullable(),
  destCity: z.string().min(1).nullable(),
  destState: z.string().length(2).nullable(),
  pickupDate: z.string().min(1).nullable(),
  deliveryDate: z.string().min(1).nullable(),
  loadRateDollars: z.number().nonnegative().nullable(),
  distanceMiles: z.number().int().positive().nullable(),
  weightLbs: z.number().int().positive().nullable(),
  equipmentType: z.enum(EQUIPMENT_VALUES).nullable(),
  brokerName: z.string().min(1).nullable(),
  brokerContact: z.string().min(1).nullable(),
  brokerPhone: z.string().min(1).nullable(),
});

const EMPTY: ParsedLoad = {
  originCity: null,
  originState: null,
  destCity: null,
  destState: null,
  pickupDate: null,
  deliveryDate: null,
  loadRateDollars: null,
  distanceMiles: null,
  weightLbs: null,
  equipmentType: null,
  brokerName: null,
  brokerContact: null,
  brokerPhone: null,
  rpm: null,
};

const SYSTEM_PROMPT = `You extract structured truckload data from messy load text that a dispatcher pasted out of DAT One or a broker email. The text is unstructured and may contain extra noise, abbreviations, and inconsistent formatting.

Return ONLY a single JSON object — no markdown, no code fences, no commentary before or after. The object must have EXACTLY these keys:

{
  "originCity": string | null,
  "originState": string | null,        // two-letter US state code, uppercase
  "destCity": string | null,
  "destState": string | null,          // two-letter US state code, uppercase
  "pickupDate": string | null,         // ISO 8601, interpret in America/New_York
  "deliveryDate": string | null,       // ISO 8601, interpret in America/New_York
  "loadRateDollars": number | null,    // total line-haul rate in dollars, no $ or commas
  "distanceMiles": number | null,      // integer miles
  "weightLbs": number | null,          // integer pounds
  "equipmentType": string | null,      // one of: dry_van, reefer, flatbed, step_deck, power_only, other
  "brokerName": string | null,
  "brokerContact": string | null,      // contact person name
  "brokerPhone": string | null
}

Rules:
- Use null for any field you cannot determine. Never guess or fabricate.
- equipmentType MUST be one of the exact enum values. Map synonyms: "van"/"dry"→dry_van, "reefer"/"refrigerated"→reefer, "flat"/"flatbed"→flatbed, "stepdeck"/"step deck"→step_deck, "power only"/"PO"→power_only. Anything else→other.
- States are two-letter uppercase codes (e.g. "TX", "CA"). Convert full state names.
- Dates: output ISO 8601. If a year is missing, assume the current year. If only a date is given, use 00:00. Interpret all times in America/New_York (Eastern). Do not convert to UTC.
- loadRateDollars is the total flat rate for the whole load, not per mile.
- Output strictly valid JSON. Do not wrap it in backticks.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

// Pull a JSON object out of the model's text, tolerating stray fences/prose.
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenceless = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(fenceless);
  } catch {
    // fall through
  }
  const first = fenceless.indexOf("{");
  const last = fenceless.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(fenceless.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export async function parseLoadText(rawText: string): Promise<ParsedLoad> {
  if (!rawText || !rawText.trim()) return { ...EMPTY };

  try {
    const message = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      // System prompt is the stable prefix → cache it. Raw text is volatile
      // and goes in the user turn (after the cache breakpoint).
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: rawText }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const json = extractJsonObject(text);
    const parsed = parsedSchema.safeParse(json);
    if (!parsed.success) return { ...EMPTY };

    const data = parsed.data;
    return {
      ...data,
      originState: data.originState ? data.originState.toUpperCase() : null,
      destState: data.destState ? data.destState.toUpperCase() : null,
      rpm: computeRpm(data.loadRateDollars, data.distanceMiles),
    };
  } catch (err) {
    console.error("[parser] parseLoadText failed:", (err as Error).message);
    return { ...EMPTY };
  }
}
