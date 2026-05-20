import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ArrowLeft, X, Save } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";
import { useWebSocket } from "@/lib/ws";
import { REGION_GROUPS, US_STATES } from "@/lib/states";
import {
  OPS_TZ,
  type CarrierWithPreferences,
  type CarrierPreferences,
} from "@shared/schema";

const EQUIPMENT_TYPES = [
  { value: "dry_van", label: "Dry van" },
  { value: "reefer", label: "Reefer" },
  { value: "flatbed", label: "Flatbed" },
  { value: "step_deck", label: "Step deck" },
  { value: "power_only", label: "Power only" },
  { value: "other", label: "Other" },
] as const;

const formSchema = z.object({
  currentCity: z.string().nullable().optional(),
  currentState: z.string().nullable().optional(),
  availableFrom: z.string().nullable().optional(),
  preferredRegions: z.array(z.string()).default([]),
  equipmentType: z
    .enum(["dry_van", "reefer", "flatbed", "step_deck", "power_only", "other"])
    .nullable()
    .optional(),
  weightCapLbs: z.string().nullable().optional(),
  minimumRpm: z.string().nullable().optional(),
  facilityBlacklist: z.array(z.string()).default([]),
  channelPreference: z.enum(["text", "call", "email"]).default("text"),
  notes: z.string().nullable().optional(),
});
type FormValues = z.infer<typeof formSchema>;

function emptyDefaults(): FormValues {
  return {
    currentCity: "",
    currentState: "",
    availableFrom: "",
    preferredRegions: [],
    equipmentType: null,
    weightCapLbs: "",
    minimumRpm: "",
    facilityBlacklist: [],
    channelPreference: "text",
    notes: "",
  };
}

function prefsToFormValues(prefs: CarrierPreferences | null): FormValues {
  if (!prefs) return emptyDefaults();
  return {
    currentCity: prefs.currentCity ?? "",
    currentState: prefs.currentState ?? "",
    availableFrom: prefs.availableFrom
      ? formatInTimeZone(
          new Date(prefs.availableFrom),
          OPS_TZ,
          "yyyy-MM-dd'T'HH:mm",
        )
      : "",
    preferredRegions: prefs.preferredRegions ?? [],
    equipmentType: prefs.equipmentType ?? null,
    weightCapLbs:
      prefs.weightCapLbs === null || prefs.weightCapLbs === undefined
        ? ""
        : String(prefs.weightCapLbs),
    minimumRpm: prefs.minimumRpm ?? "",
    facilityBlacklist: prefs.facilityBlacklist ?? [],
    channelPreference: prefs.channelPreference ?? "text",
    notes: prefs.notes ?? "",
  };
}

function carrierDetailKey(id: string) {
  return ["carriers", "detail", id] as const;
}

export default function CarrierDetailPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const [blacklistInput, setBlacklistInput] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: carrierDetailKey(id),
    queryFn: () =>
      api.get<{ carrier: CarrierWithPreferences }>(`/api/carriers/${id}`),
  });

  useWebSocket({
    invalidate: {
      carrier_preferences_updated: carrierDetailKey(id),
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyDefaults(),
  });
  const { register, handleSubmit, control, reset, watch, setValue } = form;

  useEffect(() => {
    if (data?.carrier) {
      reset(prefsToFormValues(data.carrier.preferences));
    }
  }, [data, reset]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        currentCity: values.currentCity?.trim() || null,
        currentState: values.currentState?.trim()
          ? values.currentState.toUpperCase()
          : null,
        availableFrom: values.availableFrom
          ? fromZonedTime(values.availableFrom, OPS_TZ).toISOString()
          : null,
        preferredRegions: values.preferredRegions ?? [],
        equipmentType: values.equipmentType ?? null,
        weightCapLbs: values.weightCapLbs
          ? Number(values.weightCapLbs)
          : null,
        minimumRpm: values.minimumRpm?.toString().trim() || null,
        facilityBlacklist: values.facilityBlacklist ?? [],
        channelPreference: values.channelPreference ?? "text",
        notes: values.notes?.trim() || null,
      };
      return api.put<{ preferences: CarrierPreferences }>(
        `/api/carriers/${id}/preferences`,
        payload,
      );
    },
    onSuccess: (result) => {
      qc.setQueryData<{ carrier: CarrierWithPreferences }>(
        carrierDetailKey(id),
        (prev) =>
          prev
            ? {
                carrier: { ...prev.carrier, preferences: result.preferences },
              }
            : prev,
      );
      qc.invalidateQueries({ queryKey: ["carriers", "list"] });
    },
  });

  const lastUpdated = data?.carrier.preferences?.updatedAt;
  const lastUpdatedDisplay = useMemo(() => {
    if (!lastUpdated) return null;
    return formatInTimeZone(
      new Date(lastUpdated),
      OPS_TZ,
      "MMM d, yyyy h:mm a 'ET'",
    );
  }, [lastUpdated]);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading carrier…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-6 text-destructive">
        Failed to load carrier: {(error as Error | null)?.message ?? "Unknown error"}
      </div>
    );
  }
  const carrier = data.carrier;

  const onSubmit = handleSubmit((values) => save.mutate(values));

  const facilityValues = watch("facilityBlacklist");

  const addFacility = () => {
    const next = blacklistInput.trim();
    if (!next) return;
    const current = facilityValues ?? [];
    if (current.includes(next)) {
      setBlacklistInput("");
      return;
    }
    setValue("facilityBlacklist", [...current, next], { shouldDirty: true });
    setBlacklistInput("");
  };

  const handleBlacklistKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addFacility();
    }
  };

  const removeFacility = (value: string) => {
    setValue(
      "facilityBlacklist",
      (facilityValues ?? []).filter((v) => v !== value),
      { shouldDirty: true },
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="gap-2">
          <Link href="/carriers">
            <ArrowLeft className="h-4 w-4" />
            All carriers
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        {/* LEFT — carrier info */}
        <Card>
          <CardHeader>
            <CardTitle>{carrier.company}</CardTitle>
            <Badge variant={carrier.status === "active" ? "success" : "muted"}>
              {carrier.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="Contact" value={carrier.contactName} />
            <InfoRow label="MC #" value={carrier.mcNumber} />
            <InfoRow label="Phone" value={carrier.phone ?? "—"} />
            <InfoRow label="Email" value={carrier.email ?? "—"} />
            <InfoRow
              label="Onboarded"
              value={
                carrier.onboardedAt
                  ? formatInTimeZone(
                      new Date(carrier.onboardedAt),
                      OPS_TZ,
                      "MMM d, yyyy",
                    )
                  : "—"
              }
            />
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                Notes
              </div>
              <div className="mt-1 whitespace-pre-wrap text-foreground">
                {carrier.notes ?? "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT — preferences form */}
        <Card>
          <CardHeader>
            <CardTitle>Lane preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <div className="space-y-2">
                  <Label htmlFor="currentCity">Current city</Label>
                  <Input id="currentCity" {...register("currentCity")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currentState">State</Label>
                  <Controller
                    control={control}
                    name="currentState"
                    render={({ field }) => (
                      <Select
                        value={field.value ?? ""}
                        onValueChange={(v) => field.onChange(v)}
                      >
                        <SelectTrigger id="currentState">
                          <SelectValue placeholder="State" />
                        </SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((s) => (
                            <SelectItem key={s.code} value={s.code}>
                              {s.code} — {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="availableFrom">
                  Available from{" "}
                  <span className="text-muted-foreground">(ET)</span>
                </Label>
                <Input
                  id="availableFrom"
                  type="datetime-local"
                  {...register("availableFrom")}
                />
                {watch("availableFrom") ? (
                  <p className="text-xs text-muted-foreground">
                    Stored as{" "}
                    {formatInTimeZone(
                      fromZonedTime(watch("availableFrom") as string, OPS_TZ),
                      OPS_TZ,
                      "MMM d, yyyy h:mm a 'ET'",
                    )}
                  </p>
                ) : null}
              </div>

              <Controller
                control={control}
                name="preferredRegions"
                render={({ field }) => (
                  <div className="space-y-3">
                    <Label>Preferred regions</Label>
                    <div className="grid gap-4 md:grid-cols-2">
                      {REGION_GROUPS.map((group) => (
                        <div
                          key={group.region}
                          className="rounded-md border p-3"
                        >
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {group.region}
                          </div>
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                            {group.states.map((code) => {
                              const checked = field.value?.includes(code) ?? false;
                              return (
                                <label
                                  key={code}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(c) => {
                                      const set = new Set(field.value ?? []);
                                      if (c) set.add(code);
                                      else set.delete(code);
                                      field.onChange(Array.from(set));
                                    }}
                                  />
                                  <span>{code}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="equipmentType">Equipment</Label>
                  <Controller
                    control={control}
                    name="equipmentType"
                    render={({ field }) => (
                      <Select
                        value={field.value ?? ""}
                        onValueChange={(v) =>
                          field.onChange(v as FormValues["equipmentType"])
                        }
                      >
                        <SelectTrigger id="equipmentType">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {EQUIPMENT_TYPES.map((eq) => (
                            <SelectItem key={eq.value} value={eq.value}>
                              {eq.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weightCapLbs">Weight cap (lbs)</Label>
                  <Input
                    id="weightCapLbs"
                    type="number"
                    inputMode="numeric"
                    {...register("weightCapLbs")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minimumRpm">Min RPM ($)</Label>
                  <Input
                    id="minimumRpm"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    {...register("minimumRpm")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="facilityBlacklist">Facility blacklist</Label>
                <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
                  {(facilityValues ?? []).map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
                    >
                      {f}
                      <button
                        type="button"
                        onClick={() => removeFacility(f)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${f}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    id="facilityBlacklist"
                    value={blacklistInput}
                    onChange={(e) => setBlacklistInput(e.target.value)}
                    onKeyDown={handleBlacklistKey}
                    onBlur={addFacility}
                    placeholder="Type a facility, press Enter"
                    className="min-w-[12rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Channel preference</Label>
                <Controller
                  control={control}
                  name="channelPreference"
                  render={({ field }) => (
                    <RadioGroup
                      className="flex gap-4"
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as "text" | "call" | "email")
                      }
                    >
                      {(["text", "call", "email"] as const).map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-2 text-sm capitalize"
                        >
                          <RadioGroupItem value={opt} />
                          {opt}
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={4} {...register("notes")} />
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button
                  type="submit"
                  className="gap-2"
                  disabled={save.isPending}
                >
                  <Save className="h-4 w-4" />
                  {save.isPending ? "Saving…" : "Save preferences"}
                </Button>
                <div className="text-xs text-muted-foreground">
                  {save.isError ? (
                    <span className="text-destructive">
                      {(save.error as Error).message}
                    </span>
                  ) : lastUpdatedDisplay ? (
                    <>Last updated {lastUpdatedDisplay}</>
                  ) : (
                    <>Not yet saved</>
                  )}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}
