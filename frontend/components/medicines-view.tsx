"use client";
import { useState, useMemo } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  ChatCircleDots,
  Clock,
  Drop,
  FirstAid,
  Flask,
  ListBullets,
  MagnifyingGlass,
  Moon,
  Pill,
  Printer,
  Sparkle,
  SquaresFour,
  Sun,
  SunHorizon,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { formatDate, useI18n } from "@/lib/i18n";
import { pick, type HealthRecord, type Medication } from "@/lib/types";
import { currentMedicines, schedule, tidyName, type Slot } from "@/lib/clinical";
import { ScheduleCells } from "./med-schedule";
import { Badge, Card, Empty, Skeleton, cx } from "./ui";

type ViewMode = "routine" | "grid" | "table";
type FormFilter = "all" | "tablet" | "syrup" | "drops";

// Exact times come from each prescription (see the Care plan tab), not from fixed clock ranges.
const ROUTINE_SLOTS: { slot: Slot; label: string; Icon: typeof Sun; tone: string }[] = [
  { slot: "morning", label: "Morning", Icon: SunHorizon, tone: "text-fg-2 bg-subtle border-line" },
  { slot: "afternoon", label: "Afternoon", Icon: Sun, tone: "text-fg-2 bg-subtle border-line" },
  { slot: "night", label: "Night", Icon: Moon, tone: "text-fg-2 bg-subtle border-line" },
];

function getFormIcon(form?: string | null, name?: string) {
  const str = `${form || ""} ${name || ""}`.toLowerCase();
  if (str.includes("syrup") || str.includes("suspension") || str.includes("liquid") || str.includes("solution")) {
    return Flask;
  }
  if (str.includes("drop") || str.includes("drops") || str.includes("saline") || str.includes("nasal")) {
    return Drop;
  }
  if (str.includes("inj") || str.includes("injection") || str.includes("vaccine")) {
    return FirstAid;
  }
  return Pill;
}

function getFormBadgeTone(form?: string | null, name?: string) {
  const str = `${form || ""} ${name || ""}`.toLowerCase();
  if (str.includes("syrup") || str.includes("suspension") || str.includes("liquid")) {
    return "border-warn/30 bg-warn-soft text-warn";
  }
  if (str.includes("drop") || str.includes("drops") || str.includes("saline")) {
    return "border-line bg-subtle text-fg-2";
  }
  if (str.includes("inj") || str.includes("injection")) {
    return "border-high/30 bg-high-soft text-high";
  }
  return "border-ok/30 bg-ok-soft text-ok";
}

export function MedicinesView({
  records,
  onOpen,
  onAsk,
}: {
  records: HealthRecord[] | null;
  onOpen: (id: string) => void;
  onAsk?: (query: string) => void;
}) {
  const { t, lang } = useI18n();
  const [viewMode, setViewMode] = useState<ViewMode>("routine");
  const [formFilter, setFormFilter] = useState<FormFilter>("all");
  const [search, setSearch] = useState("");

  // Get active medications from latest prescriptions
  const allRows = useMemo(() => {
    return records ? currentMedicines(records) : [];
  }, [records]);

  // Counts by form
  const counts = useMemo(() => {
    let tablet = 0, syrup = 0, drops = 0;
    allRows.forEach(({ m }) => {
      const s = `${m.form || ""} ${m.name}`.toLowerCase();
      if (s.includes("syrup") || s.includes("suspension") || s.includes("liquid")) syrup++;
      else if (s.includes("drop") || s.includes("saline")) drops++;
      else tablet++;
    });
    return { all: allRows.length, tablet, syrup, drops };
  }, [allRows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return allRows.filter(({ m, r }) => {
      // Form filter
      if (formFilter !== "all") {
        const s = `${m.form || ""} ${m.name}`.toLowerCase();
        if (formFilter === "tablet" && (s.includes("syrup") || s.includes("drop") || s.includes("saline"))) return false;
        if (formFilter === "syrup" && !(s.includes("syrup") || s.includes("suspension") || s.includes("liquid"))) return false;
        if (formFilter === "drops" && !(s.includes("drop") || s.includes("saline"))) return false;
      }
      // Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const doc = (r.extracted.doctor_name || "").toLowerCase();
        const facility = (r.extracted.facility_name || "").toLowerCase();
        const inst = (pick(m.instructions, lang) || "").toLowerCase();
        const matches =
          m.name.toLowerCase().includes(q) ||
          (m.dosage && m.dosage.toLowerCase().includes(q)) ||
          (m.timing && m.timing.toLowerCase().includes(q)) ||
          inst.includes(q) ||
          doc.includes(q) ||
          facility.includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [allRows, formFilter, search, lang]);

  // Hooks above always run; only now is it safe to bail out while records load.
  if (!records) {
    return (
      <Card>
        <div className="space-y-4 p-6" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </Card>
    );
  }

  // Slot calculations
  const morningCount = allRows.filter(({ m }) => {
    const s = schedule(m);
    return s.kind === "slots" && s.slots.morning !== "0";
  }).length;
  const afternoonCount = allRows.filter(({ m }) => {
    const s = schedule(m);
    return s.kind === "slots" && s.slots.afternoon !== "0";
  }).length;
  const nightCount = allRows.filter(({ m }) => {
    const s = schedule(m);
    return s.kind === "slots" && s.slots.night !== "0";
  }).length;
  const asNeededCount = allRows.filter(({ m }) => schedule(m).kind === "asNeeded").length;

  // Latest prescriber info
  const latestRx = records.find((r) => r.document_type === "Prescription") || records[0];

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Header Stat & Hero Panel */}
      <div className="panel overflow-hidden p-4 sm:p-5 relative">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
                <Pill size={16} weight="duotone" />
              </span>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-fg">
                {t.medsTitle}
              </h2>
              <Badge tone="accent" className="font-semibold text-[11px] py-0">
                {t.medsActive(allRows.length)}
              </Badge>
            </div>
            <p className="text-xs text-fg-3 leading-relaxed max-w-2xl">
              {latestRx ? t.medsFrom(`${latestRx.extracted.doctor_name || tidyName(latestRx.extracted.facility_name) || t.types["Prescription"]} (${formatDate(latestRx.record_date, lang)})`) : null}
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {onAsk && (
              <button
                onClick={() =>
                  onAsk(
                    `Please check for any potential drug interactions, food precautions, and timing conflicts between all my current medications: ${allRows
                      .map(({ m }) => `${m.name} ${m.dosage || ""}`)
                      .join(", ")}.`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition-all hover:bg-accent hover:text-accent-fg shadow-xs"
              >
                <Sparkle size={13} weight="fill" />
                <span>{t.checkInteractions}</span>
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg shadow-xs"
              title="Print medication schedule chart"
            >
              <Printer size={13} />
              <span>{t.printSchedule}</span>
            </button>
          </div>
        </div>

        {/* Routine Time Slot Pill Summary */}
        <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4 border-t border-line/80 pt-3">
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/60 p-2 sm:p-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-subtle text-fg-2">
              <SunHorizon size={16} weight="duotone" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-fg-3">{t.morning}</p>
              <p className="text-xs font-bold text-fg">{t.doses(morningCount)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/60 p-2 sm:p-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-subtle text-fg-2">
              <Sun size={16} weight="duotone" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-fg-3">{t.afternoon}</p>
              <p className="text-xs font-bold text-fg">{t.doses(afternoonCount)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/60 p-2 sm:p-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-subtle text-fg-2">
              <Moon size={16} weight="duotone" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-fg-3">{t.night}</p>
              <p className="text-xs font-bold text-fg">{t.doses(nightCount)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas/60 p-2 sm:p-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-subtle text-fg-2">
              <Clock size={16} weight="duotone" />
            </span>
            <div>
              <p className="text-[11px] font-medium text-fg-3">{t.asNeeded}</p>
              <p className="text-xs font-bold text-fg">{t.doses(asNeededCount)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & View Switcher Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.medsSearch}
            aria-label={t.medsSearch}
            className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-9 text-[16px] text-fg placeholder:text-fg-3 sm:h-10 sm:text-sm focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-xs"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Form Filter Pills */}
          <div className="flex items-center rounded-xl border border-line bg-surface p-1 shadow-xs text-xs font-medium overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setFormFilter("all")}
              className={cx(
                "rounded-lg px-2.5 py-1 transition-all",
                formFilter === "all" ? "bg-accent text-accent-fg font-semibold shadow-xs" : "text-fg-3 hover:text-fg"
              )}
            >
              All ({counts.all})
            </button>
            <button
              onClick={() => setFormFilter("tablet")}
              className={cx(
                "rounded-lg px-2.5 py-1 transition-all",
                formFilter === "tablet" ? "bg-accent text-accent-fg font-semibold shadow-xs" : "text-fg-3 hover:text-fg"
              )}
            >
              Tablets ({counts.tablet})
            </button>
            {counts.syrup > 0 && (
              <button
                onClick={() => setFormFilter("syrup")}
                className={cx(
                  "rounded-lg px-2.5 py-1 transition-all",
                  formFilter === "syrup" ? "bg-accent text-accent-fg font-semibold shadow-xs" : "text-fg-3 hover:text-fg"
                )}
              >
                Syrups ({counts.syrup})
              </button>
            )}
            {counts.drops > 0 && (
              <button
                onClick={() => setFormFilter("drops")}
                className={cx(
                  "rounded-lg px-2.5 py-1 transition-all",
                  formFilter === "drops" ? "bg-accent text-accent-fg font-semibold shadow-xs" : "text-fg-3 hover:text-fg"
                )}
              >
                Drops ({counts.drops})
              </button>
            )}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center rounded-xl border border-line bg-surface p-1 shadow-xs text-fg-3">
            <button
              onClick={() => setViewMode("routine")}
              title="Daily Routine View"
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "routine" ? "bg-accent text-accent-fg font-semibold shadow-xs" : "hover:text-fg"
              )}
            >
              <CalendarCheck size={14} />
              <span className="hidden md:inline">Routine</span>
            </button>
            <button
              onClick={() => setViewMode("grid")}
              title="Cards Grid View"
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "grid" ? "bg-accent text-accent-fg font-semibold shadow-xs" : "hover:text-fg"
              )}
            >
              <SquaresFour size={14} />
              <span className="hidden md:inline">Cards</span>
            </button>
            <button
              onClick={() => setViewMode("table")}
              title="Table View"
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                viewMode === "table" ? "bg-accent text-accent-fg font-semibold shadow-xs" : "hover:text-fg"
              )}
            >
              <ListBullets size={14} />
              <span className="hidden md:inline">Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {filteredRows.length === 0 ? (
        <Card className="py-12 text-center">
          <Empty
            icon={<Pill size={32} />}
            title={search ? "No matching medications found" : t.noneYet}
          />
        </Card>
      ) : viewMode === "routine" ? (
        /* ========================================================================= */
        /* VIEW 1: DAILY ROUTINE TIMELINE                                            */
        /* ========================================================================= */
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {ROUTINE_SLOTS.map(({ slot, Icon, tone }) => {
              const medsInSlot = filteredRows.filter(({ m }) => {
                const s = schedule(m);
                return s.kind === "slots" && s.slots[slot] !== "0";
              });

              return (
                <div key={slot} className="panel flex flex-col justify-between overflow-hidden p-5">
                  <div>
                    {/* Time Slot Header */}
                    <div className="flex items-center justify-between border-b border-line pb-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className={cx("grid h-8 w-8 place-items-center rounded-lg border", tone)}>
                          <Icon size={18} weight="duotone" />
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-fg">{t[slot]}</h3>
                        </div>
                      </div>
                      <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-fg-2 num">
                        {medsInSlot.length}
                      </span>
                    </div>

                    {/* Medications in this slot */}
                    <ul className="mt-4 space-y-3">
                      {medsInSlot.length === 0 ? (
                        <li className="py-6 text-center text-xs text-fg-3 italic">
                          —
                        </li>
                      ) : (
                        medsInSlot.map(({ m, r }, i) => {
                          const MedIcon = getFormIcon(m.form, m.name);
                          const instruction = pick(m.instructions, lang);
                          return (
                            <li
                              key={i}
                              className="group rounded-xl border border-line bg-canvas/70 p-3 transition-all hover:border-accent/40 hover:bg-surface"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                                    <MedIcon size={14} weight="fill" />
                                  </span>
                                  <span className="font-semibold text-sm text-fg truncate">
                                    {m.name}
                                  </span>
                                </div>
                                {m.dosage && (
                                  <span className="num shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-xs font-bold text-fg border border-line">
                                    {m.dosage}
                                  </span>
                                )}
                              </div>

                              {/* Timing & Food Relation */}
                              <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                                {m.timing && (
                                  <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
                                    {m.timing}
                                  </span>
                                )}
                                {m.frequency && (
                                  <span className="text-fg-3">· {m.frequency}</span>
                                )}
                              </div>

                              {instruction && (
                                <p className="mt-2 text-xs leading-relaxed text-fg-2 border-t border-line/50 pt-2 line-clamp-2">
                                  {instruction}
                                </p>
                              )}

                              {/* Row Action Footer */}
                              <div className="mt-3 flex items-center justify-between border-t border-line/40 pt-2 text-[11px]">
                                <button
                                  onClick={() => onOpen(r.id)}
                                  className="text-fg-3 hover:text-fg truncate max-w-[130px]"
                                  title={r.extracted.doctor_name || "Doctor"}
                                >
                                  {r.extracted.doctor_name || "Prescription"}
                                </button>
                                {onAsk && (
                                  <button
                                    onClick={() =>
                                      onAsk(
                                        `Explain how and when to take ${m.name} ${m.dosage || ""} in plain words. What are the key precautions?`
                                      )
                                    }
                                    className="font-semibold text-accent hover:underline flex items-center gap-0.5"
                                  >
                                    <span>{t.askThisQuestion}</span>
                                    <ArrowRight size={11} />
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>

          {/* As Needed / SOS Card (if any) */}
          {allRows.some(({ m }) => schedule(m).kind === "asNeeded") && (
            <div className="panel p-5">
              <div className="flex items-center gap-2 border-b border-line pb-3">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-ok-soft text-ok">
                  <Clock size={16} weight="duotone" />
                </span>
                <h3 className="text-sm font-semibold text-fg">As Needed / PRN Medications</h3>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {allRows
                  .filter(({ m }) => schedule(m).kind === "asNeeded")
                  .map(({ m, r }, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl border border-line bg-canvas p-3">
                      <div>
                        <p className="font-semibold text-sm text-fg">{m.name} <span className="num font-normal text-xs text-fg-3">{m.dosage}</span></p>
                        <p className="text-xs text-fg-2 mt-0.5">{pick(m.instructions, lang) || m.timing || "Take when needed"}</p>
                      </div>
                      <Badge tone="accent">SOS</Badge>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      ) : viewMode === "grid" ? (
        /* ========================================================================= */
        /* VIEW 2: DETAILED CARDS GRID                                               */
        /* ========================================================================= */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRows.map(({ m, r }, idx) => {
            const MedIcon = getFormIcon(m.form, m.name);
            const badgeTone = getFormBadgeTone(m.form, m.name);
            const instruction = pick(m.instructions, lang);

            return (
              <div
                key={idx}
                className="group relative flex flex-col justify-between panel p-5 rounded-2xl transition-all duration-200 hover:border-fg/30 hover:shadow-card"
              >
                <div>
                  {/* Top Header */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                        <MedIcon size={20} weight="duotone" />
                      </span>
                      <div className="min-w-0">
                        <h4 className="text-base font-bold text-fg truncate">{m.name}</h4>
                        {m.form && (
                          <span className={cx("mt-0.5 inline-block rounded-md border px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider", badgeTone)}>
                            {m.form}
                          </span>
                        )}
                      </div>
                    </div>
                    {m.dosage && (
                      <span className="num shrink-0 rounded-lg bg-surface px-2 py-1 text-xs font-bold text-fg border border-line shadow-xs">
                        {m.dosage}
                      </span>
                    )}
                  </div>

                  {/* Schedule Pills & Frequency */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
                    <ScheduleCells m={m} />
                    {m.timing && (
                      <span className="rounded-md bg-accent-soft px-2 py-1 text-xs font-semibold text-accent">
                        {m.timing}
                      </span>
                    )}
                    {m.duration && (
                      <span className="rounded-md bg-subtle px-2 py-1 text-xs text-fg-3 num">
                        {m.duration}
                      </span>
                    )}
                  </div>

                  {/* Doctor's Instructions */}
                  {instruction && (
                    <div className="mt-3.5 rounded-xl border border-line bg-canvas p-3 text-xs leading-relaxed text-fg-2">
                      <p className="font-medium text-fg-3 text-[10px] uppercase tracking-wider mb-1">Doctor&apos;s Advice</p>
                      <p>{instruction}</p>
                    </div>
                  )}

                  {m.uncertain && (
                    <p className="mt-2.5 flex items-center gap-1.5 text-xs text-warn">
                      <WarningCircle size={14} weight="fill" />
                      <span>{t.hardToRead}</span>
                    </p>
                  )}
                </div>

                {/* Card Action Footer */}
                <div className="mt-5 border-t border-line pt-3 flex items-center justify-between text-xs">
                  <button
                    onClick={() => onOpen(r.id)}
                    className="flex items-center gap-1 text-fg-3 hover:text-fg font-medium truncate max-w-[150px]"
                    title={`Prescribed by ${r.extracted.doctor_name || "Doctor"}`}
                  >
                    <span className="truncate">{r.extracted.doctor_name || tidyName(r.extracted.facility_name) || "Prescription"}</span>
                    <ArrowUpRight size={12} className="shrink-0" />
                  </button>

                  {onAsk && (
                    <button
                      onClick={() =>
                        onAsk(
                          `Please explain the dosage instructions, intended purpose, and precautions for ${m.name} (${m.dosage || "prescribed dosage"}) in simple words.`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-fg transition-colors shadow-xs"
                      title="Ask Copilot about this medicine"
                    >
                      <Sparkle size={12} weight="fill" />
                      <span>{t.askThisQuestion}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ========================================================================= */
        /* VIEW 3: COMPACT SCHEDULE TABLE                                            */
        /* ========================================================================= */
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-line bg-subtle/50 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                  <th className="px-5 py-3.5">Medicine &amp; Form</th>
                  <th className="px-4 py-3.5">Dosage</th>
                  <th className="px-4 py-3.5">Schedule</th>
                  <th className="px-4 py-3.5">Instructions &amp; Timing</th>
                  <th className="px-4 py-3.5">Prescribed By</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredRows.map(({ m, r }, i) => {
                  const MedIcon = getFormIcon(m.form, m.name);
                  const instruction = pick(m.instructions, lang);
                  return (
                    <tr key={i} className="hover:bg-hover/40 transition-colors">
                      <td className="px-5 py-4 font-semibold text-fg">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                            <MedIcon size={16} weight="fill" />
                          </span>
                          <div>
                            <span className="block font-bold">{m.name}</span>
                            {m.form && <span className="text-[11px] font-normal text-fg-3">{m.form}</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 num font-semibold text-fg">
                        {m.dosage || "–"}
                      </td>
                      <td className="px-4 py-4">
                        <ScheduleCells m={m} />
                      </td>
                      <td className="px-4 py-4 max-w-xs text-xs text-fg-2">
                        {instruction || [m.timing, m.frequency].filter(Boolean).join(" · ") || "–"}
                      </td>
                      <td className="px-4 py-4 text-xs text-fg-3 whitespace-nowrap">
                        <button
                          onClick={() => onOpen(r.id)}
                          className="hover:underline hover:text-accent font-medium block"
                        >
                          {r.extracted.doctor_name || "Doctor"}
                        </button>
                        <span className="num text-[11px] text-fg-3/80">{formatDate(r.record_date, lang)}</span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {onAsk && (
                          <button
                            onClick={() =>
                              onAsk(
                                `What is ${m.name} prescribed for, and how should it be taken?`
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-fg transition-colors"
                          >
                            <span>Ask</span>
                            <ArrowRight size={11} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Copilot Safety & Interaction Assistant Banner */}
      {onAsk && (
        <div className="panel p-5 border border-accent/20 bg-accent-soft/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg">
                <Sparkle size={18} weight="fill" />
              </span>
              <div>
                <h4 className="text-sm font-semibold text-fg">Have questions about your medications?</h4>
                <p className="text-xs text-fg-3">
                  Ask Health Copilot to clarify dosages, food restrictions, or side effects.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  onAsk(
                    "Are there any drug-drug interactions between the medications I am currently prescribed?"
                  )
                }
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-2 hover:border-accent hover:text-accent transition-colors"
              >
                Any drug interactions?
              </button>
              <button
                onClick={() =>
                  onAsk(
                    "What foods, drinks, or habits should I avoid while taking these prescribed medicines?"
                  )
                }
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-2 hover:border-accent hover:text-accent transition-colors"
              >
                Food restrictions?
              </button>
              <button
                onClick={() =>
                  onAsk(
                    "What should I do if I miss a scheduled dose of my medication?"
                  )
                }
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-2 hover:border-accent hover:text-accent transition-colors"
              >
                Missed dose advice?
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
