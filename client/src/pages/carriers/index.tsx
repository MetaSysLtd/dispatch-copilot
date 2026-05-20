import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { formatInTimeZone } from "date-fns-tz";
import { Search, Upload, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/ws";
import { OPS_TZ, type CarrierWithPreferences } from "@shared/schema";

const carriersKey = ["carriers", "list"] as const;

function formatRpm(value: string | null | undefined): string {
  if (!value) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return `$${num.toFixed(2)}`;
}

function formatEquipment(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatChannel(value: string | null | undefined): string {
  if (!value) return "—";
  return value[0].toUpperCase() + value.slice(1);
}

function formatAvailableFrom(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return formatInTimeZone(date, OPS_TZ, "MMM d, h:mm a 'ET'");
}

export default function CarriersListPage() {
  const [query, setQuery] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: carriersKey,
    queryFn: () =>
      api.get<{ carriers: CarrierWithPreferences[] }>("/api/carriers"),
  });

  useWebSocket({
    invalidate: {
      carrier_preferences_updated: carriersKey,
    },
  });

  const filtered = useMemo(() => {
    const carriers = data?.carriers ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return carriers;
    return carriers.filter(
      (c) =>
        c.company.toLowerCase().includes(q) ||
        c.mcNumber.toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Carriers</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.carriers.length} carriers in your network` : "—"}
          </p>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              Import carriers
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import carriers</DialogTitle>
              <DialogDescription>
                Place your CSV at <code>scripts/carriers.csv</code> and run:
              </DialogDescription>
            </DialogHeader>
            <pre className="rounded-md bg-muted p-3 text-sm">
              npx tsx scripts/import-carriers.ts scripts/carriers.csv
            </pre>
            <p className="text-sm text-muted-foreground">
              Rows missing an MC number — or duplicates — are skipped.
            </p>
          </DialogContent>
        </Dialog>
      </header>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search company or MC number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">MC #</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Equipment</th>
              <th className="px-4 py-3 font-medium">Min RPM</th>
              <th className="px-4 py-3 font-medium">Channel</th>
              <th className="px-4 py-3 font-medium">Available from</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && (
              <tr>
                <td
                  className="px-4 py-8 text-center text-muted-foreground"
                  colSpan={9}
                >
                  Loading carriers…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td
                  className="px-4 py-8 text-center text-destructive"
                  colSpan={9}
                >
                  Failed to load carriers: {(error as Error).message}
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td
                  className="px-4 py-8 text-center text-muted-foreground"
                  colSpan={9}
                >
                  No carriers match this search.
                </td>
              </tr>
            )}
            {filtered.map((c) => {
              const p = c.preferences;
              return (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{c.company}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.contactName}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.mcNumber}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={c.status === "active" ? "success" : "muted"}
                    >
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p ? formatEquipment(p.equipmentType) : (
                      <SetupNeeded />
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p ? formatRpm(p.minimumRpm) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p ? formatChannel(p.channelPreference) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p ? formatAvailableFrom(p.availableFrom) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button asChild variant="ghost" size="sm" className="gap-1">
                      <Link href={`/carriers/${c.id}`}>
                        Open
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SetupNeeded() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>—</span>
      <Badge variant="outline" className="text-[10px] uppercase">
        Setup needed
      </Badge>
    </span>
  );
}
