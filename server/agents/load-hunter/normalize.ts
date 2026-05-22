// Broker-name normalization shared by the backfill script (which builds
// broker_scores) and the parse route (which looks brokers up). Both MUST use
// the same function or lookups will silently miss.

// Common entity/suffix noise words to strip so "ABC Logistics LLC" and
// "ABC Logistics, Inc." collapse to the same key.
const NOISE_WORDS = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "logistics",
  "transport",
  "transportation",
  "services",
  "service",
  "freight",
  "trucking",
  "carriers",
  "carrier",
  "group",
  "ltd",
]);

const SKIP_VALUES = new Set([
  "",
  "broker's details not provided",
  "brokers details not provided",
  "n/a",
  "na",
  "none",
  "unknown",
]);

/** True when the raw broker value carries no usable identity. */
export function isUnusableBroker(raw: string | null | undefined): boolean {
  if (!raw) return true;
  return SKIP_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Normalize a broker name to a stable lookup key: lowercase, strip
 * punctuation, drop entity/industry noise words, collapse whitespace.
 * Returns "" when nothing meaningful remains.
 */
export function normalizeBrokerName(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = raw
    .toLowerCase()
    .replace(/[.,&/\\()'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const kept = cleaned
    .split(" ")
    .filter((word) => word.length > 0 && !NOISE_WORDS.has(word));

  // If stripping noise words removed everything, fall back to the cleaned
  // value so we never lose a broker entirely (e.g. "Freight Services LLC").
  const result = kept.join(" ").trim();
  return result || cleaned;
}
