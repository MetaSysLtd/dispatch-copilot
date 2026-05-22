import type {
  CarrierPreferences,
  LaneRate,
  BrokerScore,
  ScoreReasons,
} from "../../../shared/schema.js";

export type { ScoreReasons };

// ─────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────

// The subset of a parsed load the scorer actually needs. Decoupled from the
// DB row so the function stays pure and trivially testable.
export interface ScorableLoad {
  rpm: number | null;
  equipmentType: string | null;
  weightLbs: number | null;
  originCity: string | null;
  originState: string | null;
  destState: string | null;
}

export type ScoreCategory = keyof ScoreReasons;

export interface ScoreResult {
  score: number;
  reasons: ScoreReasons;
  // Points contributed per category (rpm_vs_minimum is a gate → always 0).
  // Not persisted (only score + reasons are), but returned so the UI can
  // render a points badge per row on a freshly scored load.
  points: Record<ScoreCategory, number>;
}

// ─────────────────────────────────────────────────────────────────────
// Deadhead index — top 20 US trucking hubs (lat/lng). Straight-line only.
// ─────────────────────────────────────────────────────────────────────

interface LatLng {
  lat: number;
  lng: number;
}

export const DEADHEAD_CITY_INDEX: Record<string, LatLng> = {
  "chicago|il": { lat: 41.8781, lng: -87.6298 },
  "atlanta|ga": { lat: 33.749, lng: -84.388 },
  "dallas|tx": { lat: 32.7767, lng: -96.797 },
  "los angeles|ca": { lat: 34.0522, lng: -118.2437 },
  "houston|tx": { lat: 29.7604, lng: -95.3698 },
  "memphis|tn": { lat: 35.1495, lng: -90.049 },
  "indianapolis|in": { lat: 39.7684, lng: -86.1581 },
  "columbus|oh": { lat: 39.9612, lng: -82.9988 },
  "kansas city|mo": { lat: 39.0997, lng: -94.5786 },
  "phoenix|az": { lat: 33.4484, lng: -112.074 },
  "charlotte|nc": { lat: 35.2271, lng: -80.8431 },
  "nashville|tn": { lat: 36.1627, lng: -86.7816 },
  "denver|co": { lat: 39.7392, lng: -104.9903 },
  "newark|nj": { lat: 40.7357, lng: -74.1724 },
  "savannah|ga": { lat: 32.0809, lng: -81.0912 },
  "laredo|tx": { lat: 27.5306, lng: -99.4803 },
  "ontario|ca": { lat: 34.0633, lng: -117.6509 },
  "harrisburg|pa": { lat: 40.2732, lng: -76.8867 },
  "jacksonville|fl": { lat: 30.3322, lng: -81.6557 },
  "salt lake city|ut": { lat: 40.7608, lng: -111.891 },
};

function cityKey(city: string | null, state: string | null): string | null {
  if (!city || !state) return null;
  return `${city.trim().toLowerCase()}|${state.trim().toLowerCase()}`;
}

function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.7613; // earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ─────────────────────────────────────────────────────────────────────
// RPM helper — business rule: all RPM/fee math uses Math.ceil (to cents).
// ─────────────────────────────────────────────────────────────────────

export function computeRpm(
  rateDollars: number | null | undefined,
  miles: number | null | undefined,
): number | null {
  if (rateDollars == null || miles == null || miles <= 0) return null;
  return Math.ceil((rateDollars / miles) * 100) / 100;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtLbs(n: number): string {
  return `${n.toLocaleString("en-US")} lbs`;
}

function pctVsMedian(rpm: number, median: number): string {
  const pct = Math.round((rpm / median - 1) * 100);
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct}%`;
}

// ─────────────────────────────────────────────────────────────────────
// scoreLoad — pure, synchronous, no I/O.
// ─────────────────────────────────────────────────────────────────────

export function scoreLoad(
  load: ScorableLoad,
  carrierPrefs: CarrierPreferences | null,
  laneRate: Pick<LaneRate, "medianRpm"> | null,
  brokerScore: Pick<BrokerScore, "totalLoads" | "avgLoadRate"> | null,
): ScoreResult {
  const reasons: ScoreReasons = {
    rpm_vs_median: null,
    rpm_vs_minimum: "",
    equipment_match: "",
    weight_fit: "",
    direction_match: "",
    broker_history: "",
    deadhead_estimate: "",
  };
  const points: Record<ScoreCategory, number> = {
    rpm_vs_median: 0,
    rpm_vs_minimum: 0,
    equipment_match: 0,
    weight_fit: 0,
    direction_match: 0,
    broker_history: 0,
    deadhead_estimate: 0,
  };

  const rpm = load.rpm;
  const minRpm =
    carrierPrefs?.minimumRpm != null ? Number(carrierPrefs.minimumRpm) : null;

  // 1. Hard filter — RPM vs carrier minimum.
  if (minRpm != null && rpm != null && rpm < minRpm) {
    reasons.rpm_vs_minimum = `FAIL — ${fmtMoney(rpm)} below ${fmtMoney(minRpm)} min`;
    reasons.rpm_vs_median = null;
    reasons.equipment_match = "Not evaluated — failed minimum RPM";
    reasons.weight_fit = "Not evaluated — failed minimum RPM";
    reasons.direction_match = "Not evaluated — failed minimum RPM";
    reasons.broker_history = "Not evaluated — failed minimum RPM";
    reasons.deadhead_estimate = "Not evaluated — failed minimum RPM";
    return { score: 0, reasons, points };
  }
  if (minRpm != null && rpm != null) {
    reasons.rpm_vs_minimum = `PASS — ${fmtMoney(rpm - minRpm)} above minimum`;
  } else if (minRpm != null && rpm == null) {
    reasons.rpm_vs_minimum = "Unknown — load has no RPM (missing rate or miles)";
  } else {
    reasons.rpm_vs_minimum = "No minimum RPM set on carrier";
  }

  // 2. RPM vs lane median (max 25).
  const median =
    laneRate?.medianRpm != null ? Number(laneRate.medianRpm) : null;
  if (median != null && rpm != null && median > 0) {
    const delta = pctVsMedian(rpm, median);
    if (rpm >= median * 1.15) {
      points.rpm_vs_median = 25;
      reasons.rpm_vs_median = `${delta} vs lane median (well above)`;
    } else if (rpm >= median * 1.05) {
      points.rpm_vs_median = 20;
      reasons.rpm_vs_median = `${delta} above lane median`;
    } else if (rpm >= median) {
      points.rpm_vs_median = 15;
      reasons.rpm_vs_median = `${delta} at/above lane median`;
    } else if (rpm >= median * 0.9) {
      points.rpm_vs_median = 8;
      reasons.rpm_vs_median = `${delta} below lane median`;
    } else {
      points.rpm_vs_median = 0;
      reasons.rpm_vs_median = `${delta} below lane median (weak)`;
    }
  } else {
    points.rpm_vs_median = 12;
    reasons.rpm_vs_median = null; // no lane history — neutral
  }

  // 3. Equipment match (max 20).
  const carrierEq = carrierPrefs?.equipmentType ?? null;
  const loadEq = load.equipmentType ?? null;
  if (!carrierEq) {
    points.equipment_match = 10;
    reasons.equipment_match = "NEUTRAL — no equipment preference set";
  } else if (loadEq && carrierEq === loadEq) {
    points.equipment_match = 20;
    reasons.equipment_match = "MATCH";
  } else {
    points.equipment_match = 0;
    reasons.equipment_match = `MISMATCH — carrier needs ${carrierEq}, load is ${loadEq ?? "unknown"}`;
  }

  // 4. Weight fit (max 15).
  const cap = carrierPrefs?.weightCapLbs ?? null;
  const w = load.weightLbs ?? null;
  if (cap == null) {
    points.weight_fit = 10;
    reasons.weight_fit = "NEUTRAL — no weight cap set";
  } else if (w == null) {
    points.weight_fit = 10;
    reasons.weight_fit = "NEUTRAL — load weight unknown";
  } else if (w <= cap * 0.8) {
    points.weight_fit = 15;
    reasons.weight_fit = `OK — ${fmtLbs(w)} well under ${fmtLbs(cap)} cap`;
  } else if (w <= cap) {
    points.weight_fit = 10;
    reasons.weight_fit = `OK — ${fmtLbs(w)} under ${fmtLbs(cap)} cap`;
  } else {
    points.weight_fit = 0;
    reasons.weight_fit = `OVER — ${fmtLbs(w)} exceeds ${fmtLbs(cap)} cap`;
  }

  // 5. Direction match (max 20).
  const regions = carrierPrefs?.preferredRegions ?? [];
  const destState = load.destState ? load.destState.toUpperCase() : null;
  if (regions.length === 0) {
    points.direction_match = 10;
    reasons.direction_match = "NEUTRAL — no preferred regions set";
  } else if (destState && regions.includes(destState)) {
    points.direction_match = 20;
    reasons.direction_match = `GOOD — ${destState} is in preferred regions`;
  } else {
    points.direction_match = 0;
    reasons.direction_match = `OUTSIDE — ${destState ?? "unknown dest"} not in preferred regions`;
  }

  // 6. Broker history (max 10).
  const loads = brokerScore?.totalLoads ?? null;
  if (loads == null) {
    points.broker_history = 0;
    reasons.broker_history = "Unknown broker";
  } else {
    const avg =
      brokerScore?.avgLoadRate != null
        ? `, avg ${fmtMoney(Number(brokerScore.avgLoadRate))}/load`
        : "";
    if (loads >= 10) {
      points.broker_history = 10;
      reasons.broker_history = `Known — ${loads} prior loads${avg}`;
    } else {
      points.broker_history = 5;
      reasons.broker_history = `Known — ${loads} prior loads${avg} (limited history)`;
    }
  }

  // 7. Deadhead estimate (max 10).
  const fromKey = cityKey(
    carrierPrefs?.currentCity ?? null,
    carrierPrefs?.currentState ?? null,
  );
  const toKey = cityKey(load.originCity, load.originState);
  if (!fromKey) {
    points.deadhead_estimate = 5;
    reasons.deadhead_estimate = "Unknown — no current location set";
  } else if (!toKey) {
    points.deadhead_estimate = 5;
    reasons.deadhead_estimate = "Unknown — load origin missing";
  } else {
    const from = DEADHEAD_CITY_INDEX[fromKey];
    const to = DEADHEAD_CITY_INDEX[toKey];
    if (!from || !to) {
      points.deadhead_estimate = 5;
      reasons.deadhead_estimate = "Unknown — city not in index";
    } else {
      const mi = Math.ceil(haversineMiles(from, to));
      if (mi <= 50) {
        points.deadhead_estimate = 10;
        reasons.deadhead_estimate = `~${mi} mi estimated deadhead`;
      } else if (mi <= 100) {
        points.deadhead_estimate = 7;
        reasons.deadhead_estimate = `~${mi} mi estimated deadhead`;
      } else if (mi <= 150) {
        points.deadhead_estimate = 4;
        reasons.deadhead_estimate = `~${mi} mi estimated deadhead`;
      } else {
        points.deadhead_estimate = 0;
        reasons.deadhead_estimate = `~${mi} mi estimated deadhead (far)`;
      }
    }
  }

  const score =
    points.rpm_vs_median +
    points.equipment_match +
    points.weight_fit +
    points.direction_match +
    points.broker_history +
    points.deadhead_estimate;

  return { score, reasons, points };
}
