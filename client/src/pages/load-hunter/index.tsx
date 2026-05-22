import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { Crosshair, Search, Send, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/ws";
import { cn } from "@/lib/utils";
import {
  OPS_TZ,
  type CarrierWithPreferences,
  type DatCandidate,
  type ScoreReasons,
} from "@shared/schema";

const carriersKey = ["carriers", "list"] as const;
const candidatesKey = ["load-hunter", "candidates"] as const;

type ScorePoints = Partial<Record<keyof ScoreReasons, number>>;

interface ParseResult {
  candidateId: string;
  parsed: {
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
  };
  score: number;
  reasons: ScoreReasons;
  points: ScorePoints;
  carrier: CarrierWithPreferences;
}

// Normalized shape the result card renders, from either a fresh parse or a
// historical candidate row clicked in the table.
interface ScoreView {
  candidateId: string;
  carrierLabel: string;
  score: number;
  reasons: ScoreReasons;
  points?: ScorePoints;
  originCity: string | null;
  originState: string | null;
  destCity: string | null;
  destState: string | null;
  pickupDate: string | Date | null;
  loadRateDollars: number | null;
  rpm: number | null;
  distanceMiles: number | null;
  weightLbs: number | null;
  equipmentType: string | null;
  brokerName: string | null;
  brokerContact: string | null;
  brokerPhone: string | null;
  status: DatCandidate["status"];
}

const REASON_LABELS: Record<keyof ScoreReasons, string> = {
  rpm_vs_minimum: "RPM vs minimum",
  rpm_vs_median: "RPM vs lane median",
  equipment_match: "Equipment",
  weight_fit: "Weight",
  direction_match: "Direction",
  broker_history: "Broker history",
  deadhead_estimate: "Deadhead",
};

const REASON_ORDER: (keyof ScoreReasons)[] = [
  "rpm_vs_minimum",
  "rpm_vs_median",
  "equipment_match",
  "weight_fit",
  "direction_match",
  "broker_history",
  "deadhead_estimate",
];

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtRpm(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toFixed(2)}/mi`;
}

function fmtEquipment(value: string | null): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDateTime(value: string | Date | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, OPS_TZ, "MMM d, h:mm a 'ET'");
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

function scoreLabel(score: number): string {
  if (score >= 70) return "Strong Match";
  if (score >= 40) return "Possible Match";
  return "Poor Match";
}

// Classify a reason string into a sentiment for color-coding.
function reasonTone(value: string | null): "good" | "neutral" | "bad" {
  if (!value) return "neutral";
  if (/^(FAIL|MISMATCH|OVER|OUTSIDE)/.test(value)) return "bad";
  if (/^(PASS|MATCH|GOOD|OK)/.test(value) || value.startsWith("+")) return "good";
  return "neutral";
}

const toneClasses: Record<"good" | "neutral" | "bad", string> = {
  good: "bg-emerald-100 text-emerald-800",
  neutral: "bg-muted text-muted-foreground",
  bad: "bg-red-100 text-red-800",
};

function viewFromCandidate(
  c: DatCandidate,
  carrierLabel: string,
): ScoreView {
  return {
    candidateId: c.id,
    carrierLabel,
    score: c.score ?? 0,
    reasons:
      c.scoreReasons ??
      ({
        rpm_vs_minimum: "—",
        rpm_vs_median: null,
        equipment_match: "—",
        weight_fit: "—",
        direction_match: "—",
        broker_history: "—",
        deadhead_estimate: "—",
      } as ScoreReasons),
    originCity: c.originCity,
    originState: c.originState,
    destCity: c.destCity,
    destState: c.destState,
    pickupDate: c.pickupDate,
    loadRateDollars: num(c.loadRateDollars),
    rpm: num(c.rpm),
    distanceMiles: c.distanceMiles,
    weightLbs: c.weightLbs,
    equipmentType: c.equipmentType,
    brokerName: c.brokerName,
    brokerContact: c.brokerContact,
    brokerPhone: c.brokerPhone,
    status: c.status,
  };
}

function viewFromParse(r: ParseResult): ScoreView {
  return {
    candidateId: r.candidateId,
    carrierLabel: `${r.carrier.company} · MC ${r.carrier.mcNumber}`,
    score: r.score,
    reasons: r.reasons,
    points: r.points,
    originCity: r.parsed.originCity,
    originState: r.parsed.originState,
    destCity: r.parsed.destCity,
    destState: r.parsed.destState,
    pickupDate: r.parsed.pickupDate,
    loadRateDollars: r.parsed.loadRateDollars,
    rpm: r.parsed.rpm,
    distanceMiles: r.parsed.distanceMiles,
    weightLbs: r.parsed.weightLbs,
    equipmentType: r.parsed.equipmentType,
    brokerName: r.parsed.brokerName,
    brokerContact: r.parsed.brokerContact,
    brokerPhone: r.parsed.brokerPhone,
    status: "pending",
  };
}

export default function LoadHunterPage() {
  const qc = useQueryClient();
  const [carrierId, setCarrierId] = useState<string>("");
  const [rawText, setRawText] = useState("");
  const [view, setView] = useState<ScoreView | null>(null);

  const { data: carriersData } = useQuery({
    queryKey: carriersKey,
    queryFn: () =>
      api.get<{ carriers: CarrierWithPreferences[] }>("/api/carriers"),
  });
  const carriers = useMemo(
    () => (carriersData?.carriers ?? []).filter((c) => c.status === "active"),
    [carriersData],
  );
  const carrierLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of carriersData?.carriers ?? []) {
      map.set(c.id, `${c.company} · MC ${c.mcNumber}`);
    }
    return map;
  }, [carriersData]);

  const { data: candidatesData } = useQuery({
    queryKey: candidatesKey,
    queryFn: () =>
      api.get<{ candidates: DatCandidate[] }>("/api/load-hunter/candidates"),
  });
  const recent = (candidatesData?.candidates ?? []).slice(0, 20);

  useWebSocket({
    invalidate: { candidate_status_updated: candidatesKey },
  });

  const scoreMutation = useMutation({
    mutationFn: () =>
      api.post<ParseResult>("/api/load-hunter/parse", { rawText, carrierId }),
    onSuccess: (result) => {
      setView(viewFromParse(result));
      qc.invalidateQueries({ queryKey: candidatesKey });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: "rejected" | "drafted" }) =>
      api.patch<{ candidate: DatCandidate }>(
        `/api/load-hunter/candidates/${input.id}/status`,
        { status: input.status },
      ),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: candidatesKey });
      setView((prev) =>
        prev && prev.candidateId === input.id
          ? { ...prev, status: input.status }
          : prev,
      );
    },
  });

  const canScore = carrierId !== "" && rawText.trim() !== "";

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Crosshair className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Load Hunter</h1>
          <p className="text-sm text-muted-foreground">
            Paste a DAT load, pick a carrier, get a deterministic match score.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        {/* LEFT — score a load */}
        <Card>
          <CardHeader>
            <CardTitle>Score a Load</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Carrier</label>
              <CarrierCombobox
                carriers={carriers}
                value={carrierId}
                onChange={setCarrierId}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">DAT load details</label>
              <Textarea
                rows={10}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste the load text directly from DAT — origin, destination, rate, weight, broker info..."
              />
            </div>
            <Button
              className="w-full gap-2"
              disabled={!canScore || scoreMutation.isPending}
              onClick={() => scoreMutation.mutate()}
            >
              {scoreMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Parsing &amp; scoring…
                </>
              ) : (
                <>
                  <Crosshair className="h-4 w-4" />
                  Score This Load
                </>
              )}
            </Button>
            {scoreMutation.isError && (
              <p className="text-sm text-destructive">
                {(scoreMutation.error as Error).message}
              </p>
            )}
          </CardContent>
        </Card>

        {/* RIGHT — score result */}
        <Card>
          <CardHeader>
            <CardTitle>Score Result</CardTitle>
          </CardHeader>
          <CardContent>
            {!view ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Score a load to see the breakdown here.
              </p>
            ) : (
              <ScoreResult
                view={view}
                onReject={() =>
                  statusMutation.mutate({
                    id: view.candidateId,
                    status: "rejected",
                  })
                }
                rejecting={statusMutation.isPending}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent candidates */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Candidates</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Origin → Dest</th>
                  <th className="px-4 py-3 font-medium">Carrier</th>
                  <th className="px-4 py-3 font-medium">RPM</th>
                  <th className="px-4 py-3 font-medium">Broker</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recent.length === 0 && (
                  <tr>
                    <td
                      className="px-4 py-8 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      No candidates scored yet.
                    </td>
                  </tr>
                )}
                {recent.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() =>
                      setView(
                        viewFromCandidate(
                          c,
                          carrierLabelById.get(c.carrierId ?? "") ?? "—",
                        ),
                      )
                    }
                  >
                    <td className="px-4 py-3">
                      <ScoreBadge score={c.score ?? 0} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.originCity ?? "?"}, {c.originState ?? "?"} →{" "}
                      {c.destCity ?? "?"}, {c.destState ?? "?"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {carrierLabelById.get(c.carrierId ?? "") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {fmtRpm(num(c.rpm))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.brokerName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="muted" className="capitalize">
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {fmtDateTime(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 70 ? "success" : score >= 40 ? "secondary" : "destructive";
  return (
    <Badge variant={tone} className="tabular-nums">
      {score}
    </Badge>
  );
}

function ScoreResult({
  view,
  onReject,
  rejecting,
}: {
  view: ScoreView;
  onReject: () => void;
  rejecting: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Top: big score */}
      <div className="flex items-center justify-between">
        <div>
          <div className={cn("text-5xl font-bold tabular-nums", scoreColor(view.score))}>
            {view.score}
            <span className="text-2xl text-muted-foreground">/100</span>
          </div>
          <div className={cn("text-sm font-medium", scoreColor(view.score))}>
            {scoreLabel(view.score)}
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          {view.carrierLabel}
        </div>
      </div>

      {/* Parsed load details */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Parsed load details
        </h4>
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">
            {view.originCity ?? "?"}, {view.originState ?? "?"} →{" "}
            {view.destCity ?? "?"}, {view.destState ?? "?"}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-3">
            <Detail label="Rate" value={fmtMoney(view.loadRateDollars)} />
            <Detail label="RPM" value={fmtRpm(view.rpm)} />
            <Detail
              label="Distance"
              value={view.distanceMiles != null ? `${view.distanceMiles} mi` : "—"}
            />
            <Detail label="Pickup" value={fmtDateTime(view.pickupDate)} />
            <Detail
              label="Weight"
              value={
                view.weightLbs != null
                  ? `${view.weightLbs.toLocaleString("en-US")} lbs`
                  : "—"
              }
            />
            <Detail label="Equipment" value={fmtEquipment(view.equipmentType)} />
            <Detail label="Broker" value={view.brokerName ?? "—"} />
            <Detail label="Contact" value={view.brokerContact ?? "—"} />
            <Detail label="Phone" value={view.brokerPhone ?? "—"} />
          </div>
        </div>
      </section>

      {/* Score breakdown */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Score breakdown
        </h4>
        <div className="divide-y rounded-md border">
          {REASON_ORDER.map((key) => {
            const value = view.reasons[key];
            const tone = reasonTone(value);
            const pts = view.points?.[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="font-medium">{REASON_LABELS[key]}</span>
                <span className="flex items-center gap-2 text-right">
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-xs",
                      toneClasses[tone],
                    )}
                  >
                    {value ?? "No lane history"}
                  </span>
                  {pts != null && key !== "rpm_vs_minimum" && (
                    <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
                      +{pts}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Actions */}
      <section className="flex items-center gap-3">
        <Button className="gap-2" disabled title="Outreach drafting ships in week 4">
          <Send className="h-4 w-4" />
          Draft Outreach
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={onReject}
          disabled={rejecting || view.status === "rejected"}
        >
          <X className="h-4 w-4" />
          {view.status === "rejected" ? "Rejected" : "Reject"}
        </Button>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground/70">
        {label}
      </div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}

function CarrierCombobox({
  carriers,
  value,
  onChange,
}: {
  carriers: CarrierWithPreferences[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = carriers.find((c) => c.id === value) ?? null;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? carriers.filter(
          (c) =>
            c.company.toLowerCase().includes(q) ||
            c.mcNumber.toLowerCase().includes(q),
        )
      : carriers;
    return list.slice(0, 50);
  }, [carriers, query]);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search carrier by company or MC…"
          value={open ? query : selected ? selected.company : query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No active carriers match.
            </div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cn(
                "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent",
                c.id === value && "bg-accent",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c.id);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="font-medium">{c.company}</span>
              <span className="text-xs text-muted-foreground">
                MC {c.mcNumber} · {c.contactName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
