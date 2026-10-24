"use client";
import { BellRinging,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  ChatCircleDots,
  CheckCircle,
  Clock,
  FirstAid,
  Moon,
  Pill,
  Sparkle,
  Sun,
  SunHorizon,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { currentMedicines, isOut, latestTests, schedule, tidyName, type Slot } from "@/lib/clinical";
import { formatDate, useI18n } from "@/lib/i18n";
import { pick, pickList, type HealthRecord, type Profile, type Trend } from "@/lib/types";
import type { Tab } from "./app-shell";
import { RangeBar } from "./range-bar";
import { DocIcon } from "./doc-icon";
import { Timeline } from "./timeline";
import { DietGuide } from "./diet-guide";
import { Trends } from "./trends";
import { highlight } from "@/lib/highlight";
import { Badge, Button, Skeleton, cx } from "./ui";

function tidyCondition(d: string): string {
  let s = d.replace(/\s*\[.*?\]/g, "").trim();
  // If diagnosis has trailing symptom explanations in parens like "(fever with cold and cough)", trim it to keep the clinical condition clean
  s = s.replace(/\s*\((?:fever|cough|cold|pain|headache|vomiting|mild|severe|acute|chronic|with|and|due to)[^)]*\)/gi, "").trim();
  return s || d;
}

const SLOTS: { slot: Slot; Icon: typeof Sun }[] = [
  { slot: "morning", Icon: SunHorizon },
  { slot: "afternoon", Icon: Sun },
  { slot: "night", Icon: Moon },
];

export function Overview({
  records,
  profile,
  trends = [],
  onOpen,
  onTab,
  onFile,
  justUploaded,
  onDismissJustUploaded,
  onAsk,
}: {
  records: HealthRecord[] | null;
  profile: Profile;
  trends?: Trend[];
  onOpen: (id: string) => void;
  onTab: (t: Tab) => void;
  onFile: (f: File) => void;
  justUploaded?: HealthRecord | null;
  onDismissJustUploaded?: () => void;
  onAsk?: (query: string) => void;
}) {
  const { t, lang } = useI18n();
  if (!records) return <OverviewSkeleton />;
  if (records.length === 0) {
    return (
      <div className="stagger">
        <ol className="grid gap-3 md:grid-cols-3">
          {t.steps.map(([title, body], i) => (
            <li key={i} className="flex gap-4 panel p-5">
              <span className="display grid h-9 w-9 shrink-0 place-items-center rounded-full bg-subtle text-[17px] font-semibold">
                {i + 1}
              </span>
              <span>
                <span className="block font-medium">{title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-fg-3">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const tests = latestTests(records);
  const out = tests.filter(({ o }) => isOut(o.flag));
  const meds = currentMedicines(records);
  const daily = meds.filter(({ m }) => schedule(m).kind === "slots");
  const other = meds.filter(({ m }) => schedule(m).kind !== "slots");
  const own = records.filter((r) => r.name_check !== "mismatch");
  const activePool = own.length > 0 ? own : records;
  const conditions = Array.from(
    new Map(
      activePool
        .flatMap((r) => r.extracted.diagnoses)
        .map((d) => {
          const clean = tidyCondition(d);
          return [clean.toLowerCase(), clean];
        })
    ).values()
  );
  const team = Array.from(
    new Set(activePool.flatMap((r) => [r.extracted.doctor_name, tidyName(r.extracted.facility_name)]).filter(Boolean))
  ) as string[];
  const latest = activePool[0] || records[0];
  const latestPrescription =
    activePool.find((r) => r.document_type === "Prescription") ||
    records.find((r) => r.document_type === "Prescription");

  // Clinical Summary record to showcase: prefer the just-uploaded record, or the latest prescription/record
  const clinicalRecord = justUploaded || latestPrescription || latest;
  const clinicalSummaryText = clinicalRecord ? pick(clinicalRecord.extracted.summary, lang) : "";
  // A later document (e.g. the re-check report) means this follow-up has probably happened;
  // the Care plan tab tracks it precisely, so don't show it here as the "next" step.
  const overtaken = !!clinicalRecord && clinicalRecord !== justUploaded &&
    records.some((r) => r.id !== clinicalRecord.id && r.name_check !== "mismatch" && (r.record_date || "") > (clinicalRecord.record_date || ""));
  const followUpText = overtaken ? null : clinicalRecord?.extracted.follow_up;
  const questionsList = clinicalRecord ? pickList(clinicalRecord.extracted.doctor_questions, lang) : [];

  return (
    <div className="stagger space-y-12">
      {/* Just Uploaded Prescription Notification Banner */}
      {justUploaded && (
        <aside
          role="status"
          aria-label="Upload notice"
          className="relative overflow-hidden rounded-2xl border border-accent/40 bg-accent-soft/80 p-5 shadow-card backdrop-blur-md transition-all animate-fade-up"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-white shadow-sm">
                <Sparkle size={22} weight="fill" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-fg">{t.rxAnalyzedBanner}</h2>
                  <Badge tone="accent">
                    {t.types[justUploaded.document_type] || justUploaded.document_type}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-fg-2">
                  {t.rxAnalyzedDesc(
                    justUploaded.extracted.doctor_name || tidyName(justUploaded.extracted.facility_name) || "",
                    justUploaded.extracted.medications.length
                  )}
                </p>
                {justUploaded.extracted.diagnoses.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-fg-3">{t.conditions}:</span>
                    {justUploaded.extracted.diagnoses.map((d) => (
                      <span
                        key={d}
                        className="rounded-md border border-line bg-surface/80 px-2 py-0.5 text-xs font-medium text-fg"
                      >
                        {tidyCondition(d)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 self-end sm:self-auto">
              {(justUploaded.extracted.medications.length > 0 || !!justUploaded.extracted.follow_up) && (
                <Button size="sm" variant="primary" icon={<BellRinging size={14} />} onClick={() => onTab("care")}>
                  {t.care.reviewReminders}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                icon={<ArrowUpRight size={14} />}
                onClick={() => onOpen(justUploaded.id)}
              >
                {t.viewSourceDoc}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<ChatCircleDots size={14} />}
                onClick={() => {
                  const bannerQuery =
                    justUploaded.extracted.diagnoses.length > 0
                      ? `Explain the diagnosis (${justUploaded.extracted.diagnoses.map(tidyCondition).join(", ")}) and prescribed medicines in simple words.`
                      : `Please explain this prescription and its medicines in simple words.`;
                  if (onAsk) {
                    onAsk(bannerQuery);
                  } else {
                    onTab("ask");
                  }
                }}
              >
                {t.askThisQuestion}
              </Button>
              {onDismissJustUploaded && (
                <button
                  onClick={onDismissJustUploaded}
                  className="rounded-lg p-1.5 text-fg-3 transition-colors hover:bg-hover hover:text-fg"
                  aria-label={t.dismiss}
                  title={t.dismiss}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Lab Results / Attention Needed */}
      {out.length > 0 && (
        <section aria-label={t.needsAttention}>
          <div className="mb-4 flex items-baseline justify-between">
            <p className="eyebrow">{t.needsAttention}</p>
            <p className="hidden text-xs text-fg-3 sm:block">{t.attentionNote}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {out.map(({ o, r }, i) => {
              const low = o.flag === "LOW";
              return (
                <button
                  key={i}
                  onClick={() => onOpen(r.id)}
                  className="group relative flex flex-col panel p-5 text-left transition-all hover:-translate-y-0.5 hover:border-fg/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[15px] font-medium leading-snug">{o.test_name}</p>
                    <span className="shrink-0 rounded-full bg-high-soft px-2.5 py-0.5 text-xs font-semibold text-high">
                      {low ? "↓" : "↑"} {t[o.flag]}
                    </span>
                  </div>
                  <p className="mt-6 flex items-baseline gap-2">
                    <span className="display text-[56px] font-semibold leading-none text-high">
                      {o.observed_value}
                    </span>
                    <span className="text-sm text-fg-3">{o.unit}</span>
                  </p>
                  <RangeBar o={o} className="mt-6" />
                  <div className="mt-2 flex justify-between text-xs text-fg-3">
                    <span>
                      {t.normal} <span className="num">{o.reference_range}</span>
                    </span>
                    <span>{formatDate(r.record_date, lang)}</span>
                  </div>
                  {o.explanation && (
                    <p className="mt-4 border-t border-line pt-4 text-sm leading-relaxed text-fg-2">
                      {highlight(pick(o.explanation, lang), [
                        "low",
                        "high",
                        "lower",
                        "higher",
                        "anaemia",
                        "deficiency",
                        "underactive",
                        "infection",
                        "inflammation",
                      ])}
                    </p>
                  )}
                  <ArrowUpRight
                    size={16}
                    className="absolute right-4 top-14 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {tests.length > 0 && out.length === 0 && (
        <div className="flex items-center gap-2 text-ok text-sm font-medium">
          <CheckCircle size={18} weight="fill" />
          <span>{t.allClear}</span>
        </div>
      )}

      {/* Same test across reports */}
      <Trends trends={trends} onOpen={onOpen} />

      {/* Doctor's Advice & Clinical Impression */}
      {clinicalSummaryText && (
        <section aria-label={t.doctorAdvice}>
          <div className="mb-4 flex items-baseline justify-between">
            <p className="eyebrow">{t.doctorAdvice}</p>
            {clinicalRecord && (
              <button
                onClick={() => onOpen(clinicalRecord.id)}
                className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
              >
                <span>{tidyName(clinicalRecord.extracted.facility_name) || clinicalRecord.extracted.doctor_name || clinicalRecord.title}</span>
                <ArrowRight size={12} />
              </button>
            )}
          </div>
          <div className="panel overflow-hidden p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                  <FirstAid size={20} weight="duotone" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-fg">
                    {clinicalRecord?.extracted.doctor_name || t.appName}
                  </h3>
                  <p className="text-xs text-fg-3">
                    {tidyName(clinicalRecord?.extracted.facility_name)}
                    {clinicalRecord?.record_date ? ` · ${formatDate(clinicalRecord.record_date, lang)}` : ""}
                  </p>
                </div>
              </div>
              <Badge tone="neutral">
                {clinicalRecord ? t.types[clinicalRecord.document_type] : t.samplePrescription}
              </Badge>
            </div>

            <div className="mt-4 text-[15px] leading-relaxed text-fg-2">
              {highlight(clinicalSummaryText, [
                "prescribed",
                "advised",
                "tablet",
                "capsule",
                "syrup",
                "dosage",
                "blood pressure",
                "diabetes",
                "hypertension",
                "infection",
                "fever",
                "pain",
                "mg",
                "daily",
                "morning",
                "night",
              ])}
            </div>

            {clinicalRecord?.extracted.diagnoses && clinicalRecord.extracted.diagnoses.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                <span className="text-xs text-fg-3">{t.diagnoses}:</span>
                {clinicalRecord.extracted.diagnoses.map((d) => (
                  <Badge key={d} tone="accent">
                    {d}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Comprehensive Active Prescription & Medication Regimen */}
      {meds.length > 0 && (
        <section aria-label={t.activeRegimen}>
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <p className="eyebrow">{t.activeRegimen}</p>
              <p className="mt-0.5 text-xs text-fg-3">{t.schedNote}</p>
            </div>
            <button
              onClick={() => onTab("medicines")}
              className="flex items-center gap-1 text-sm text-fg-3 hover:text-fg"
            >
              {t.tabs.medicines}
              <ArrowRight size={13} />
            </button>
          </div>

          {/* Daily Schedule Slots */}
          <div className="grid overflow-hidden panel md:grid-cols-3">
            {SLOTS.map(({ slot, Icon }, si) => {
              const here = daily.filter(({ m }) => {
                const s = schedule(m);
                return s.kind === "slots" && s.slots[slot] !== "0";
              });
              return (
                <div
                  key={slot}
                  className={cx("p-5", si > 0 && "border-t border-line md:border-l md:border-t-0")}
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-fg-2">
                    <Icon size={18} weight="duotone" className="text-accent" />
                    {t[slot]}
                  </p>
                  <ul className="mt-4 space-y-3">
                    {here.length === 0 ? (
                      <li className="text-sm text-fg-3">–</li>
                    ) : (
                      here.map(({ m, r }, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                          <div className="min-w-0">
                            <span className="block font-medium">
                              {m.name}{" "}
                              <span className="num text-sm font-normal text-fg-3">{m.dosage}</span>
                            </span>
                            <span className="block text-xs text-fg-3">
                              {(lang !== "en" && m.instructions
                                ? pick(m.instructions, lang)
                                : m.timing) || formatDate(r.record_date, lang)}
                            </span>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              );
            })}
          </div>

          {/* Detailed Medicine Cards Grid */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {meds.map(({ m, r }, idx) => {
              const instruction = lang !== "en" && m.instructions ? pick(m.instructions, lang) : m.instructions?.english;
              return (
                <div
                  key={idx}
                  className="group relative flex flex-col justify-between panel p-5 rounded-2xl transition-all hover:border-fg/30 hover:shadow-card"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                          <Pill size={15} weight="fill" />
                        </span>
                        <h4 className="truncate text-[15px] font-semibold text-fg">{m.name}</h4>
                      </div>
                      {m.form && (
                        <span className="shrink-0 rounded-full border border-line bg-subtle px-2.5 py-0.5 text-[11px] font-medium text-fg-3">
                          {m.form}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                      {m.dosage && (
                        <span className="rounded-md bg-canvas px-2 py-1 font-semibold text-fg num border border-line">
                          {m.dosage}
                        </span>
                      )}
                      {m.frequency && (
                        <span className="rounded-md bg-canvas px-2 py-1 text-fg-2 border border-line">
                          {m.frequency}
                        </span>
                      )}
                      {m.timing && (
                        <span className="rounded-md bg-accent-soft px-2 py-1 font-medium text-accent">
                          {m.timing}
                        </span>
                      )}
                      {m.duration && (
                        <span className="rounded-md bg-subtle px-2 py-1 text-fg-3">
                          {m.duration}
                        </span>
                      )}
                    </div>

                    {instruction && (
                      <p className="mt-3 text-xs leading-relaxed text-fg-2 border-t border-line/60 pt-2.5">
                        {instruction}
                      </p>
                    )}

                    {m.uncertain && (
                      <p className="mt-2 flex items-center gap-1 text-[11px] text-warn">
                        <WarningCircle size={13} weight="fill" />
                        <span>{t.hardToRead}</span>
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-fg-3">
                    <span className="truncate pr-2 font-medium">{r.extracted.doctor_name || tidyName(r.extracted.facility_name) || r.title}</span>
                    <button
                      onClick={() => onOpen(r.id)}
                      className="shrink-0 text-accent hover:underline flex items-center gap-0.5 font-medium"
                    >
                      <span>{t.source}</span>
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Continuity of Care: Follow-up & Doctor Questions */}
      {(followUpText || questionsList.length > 0) && (
        <section aria-label={t.carePlan}>
          <p className="eyebrow mb-4">{t.carePlan}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Follow-up card */}
            {followUpText && (
              <div className="panel flex flex-col p-5 lg:self-start">
                <div>
                  <div className="flex items-center gap-2.5 text-sm font-semibold text-fg">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-ok-soft text-ok">
                      <CalendarCheck size={18} weight="fill" />
                    </span>
                    <h4>{t.nextVisit}</h4>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-fg-2 font-medium">
                    {followUpText}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-xs text-fg-3">
                  <Clock size={14} />
                  <span>
                    {clinicalRecord?.record_date
                      ? `${t.prescribedBy} ${clinicalRecord.extracted.doctor_name || "Doctor"} (${formatDate(clinicalRecord.record_date, lang)})`
                      : t.prescribedBy}
                  </span>
                </div>
              </div>
            )}

            {/* Questions to ask doctor */}
            {questionsList.length > 0 && (
              <div className={cx("panel p-5", !followUpText && "lg:col-span-2")}>
                <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
                      <ChatCircleDots size={18} weight="duotone" />
                    </span>
                    <h4 className="text-sm font-semibold text-fg">{t.questionsForDoctor}</h4>
                  </div>
                  <button
                    onClick={() => {
                      if (onAsk && questionsList.length > 0) {
                        onAsk(questionsList[0]);
                      } else {
                        onTab("ask");
                      }
                    }}
                    className="flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    <span>{t.tabs.ask}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>

                <ul className="mt-3 space-y-2.5">
                  {questionsList.map((q, qi) => (
                    <li key={qi}>
                      <button
                        onClick={() => (onAsk ? onAsk(q) : onTab("ask"))}
                        className="group flex min-h-11 w-full items-start justify-between gap-3 rounded-lg border border-line bg-canvas p-3 text-left text-sm transition-colors hover:border-fg/30"
                      >
                        <span className="leading-relaxed text-fg-2 transition-colors group-hover:text-fg">{q}</span>
                        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-fg">
                          {t.askThisQuestion}
                          <ArrowRight size={12} aria-hidden />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Unified Health Profile Overview dl */}
      <section aria-label={t.profileTitle}>
        <div className="mb-4 flex items-baseline justify-between">
          <p className="eyebrow">{t.profileTitle}</p>
          <span className="text-xs text-fg-3">
            {t.documents(records.length)}
          </span>
        </div>
        <dl className="grid overflow-hidden panel sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 border-line p-5 sm:border-r lg:border-b-0">
            <dt className="text-xs font-medium text-fg-3">{t.conditions}</dt>
            <dd className="mt-2.5 flex flex-wrap gap-1.5 min-w-0">
              {conditions.length ? (
                conditions.map((c) => (
                  <span
                    key={c}
                    title={c}
                    className="inline-flex max-w-full items-center rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent ring-1 ring-inset ring-accent/15 leading-snug break-words"
                  >
                    <span className="line-clamp-2">{c}</span>
                  </span>
                ))
              ) : (
                <span className="text-sm text-fg-3">–</span>
              )}
            </dd>
          </div>
          <div className="min-w-0 border-t border-line p-5 sm:border-t-0 lg:border-r">
            <dt className="text-xs font-medium text-fg-3">{t.nowMeds}</dt>
            <dd className="mt-1">
              <span className="display text-[32px] font-semibold">{meds.length}</span>
              <span className="mt-0.5 block truncate text-sm text-fg-2">
                {meds.map(({ m }) => m.name).join(", ") || "–"}
              </span>
            </dd>
          </div>
          <div className="min-w-0 border-t border-line p-5 sm:border-r lg:border-t-0">
            <dt className="text-xs font-medium text-fg-3">{t.careTeam}</dt>
            <dd className="mt-2 space-y-1 text-sm">
              {team.slice(0, 3).map((x) => (
                <span key={x} className="block truncate font-medium">
                  {x}
                </span>
              ))}
              {team.length > 3 && <span className="text-xs text-fg-3">+{team.length - 3} more</span>}
              {!team.length && <span className="text-sm text-fg-3">–</span>}
            </dd>
          </div>
          <div className="min-w-0 border-t border-line p-5 lg:border-t-0">
            <dt className="text-xs font-medium text-fg-3">{t.lastUpdated}</dt>
            <dd className="mt-1">
              <span className="display text-[22px] font-semibold">
                {latest?.record_date ? formatDate(latest.record_date, lang) : "–"}
              </span>
              <span className="block text-sm text-fg-2">
                {latest ? t.types[latest.document_type] : ""}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {/* Health timeline */}
      <section aria-label={t.journey}>
        <div className="mb-4 flex items-baseline justify-between">
          <p className="eyebrow">{t.journey}</p>
          <button
            onClick={() => onTab("records")}
            className="flex items-center gap-1 text-sm text-fg-3 hover:text-fg"
          >
            {t.seeTimeline}
            <ArrowRight size={13} />
          </button>
        </div>
        <Timeline records={records} onOpen={onOpen} limit={3} />
      </section>

      {/* Personalized Indian Diet & Lifestyle Guide */}
      <DietGuide records={records} profile={profile} />
    </div>
  );
}

export function RecordRow({ r, onOpen }: { r: HealthRecord; onOpen: (id: string) => void }) {
  const { t, lang } = useI18n();
  const e = r.extracted;
  const flagged = e.lab_observations.filter((o) => isOut(o.flag)).length;
  return (
    <li>
      <button
        onClick={() => onOpen(r.id)}
        className="group flex w-full items-center gap-4 px-1 py-4 text-left transition-colors hover:bg-hover/60 sm:px-2"
      >
        <span className="num hidden w-24 shrink-0 text-sm text-fg-3 sm:block">
          {r.record_date ? formatDate(r.record_date, lang) : t.noDate}
        </span>
        <DocIcon type={r.document_type} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium">{t.types[r.document_type]}</span>
            {r.name_check === "mismatch" && <Badge tone="warn">{t.nameDiffers}</Badge>}
          </span>
          <span className="block truncate text-sm text-fg-3">
            {tidyName(e.facility_name) || e.doctor_name || r.source_filename}
            <span className="sm:hidden"> · {formatDate(r.record_date, lang)}</span>
          </span>
        </span>
        <span className="hidden shrink-0 gap-1.5 md:flex">
          {e.medications.length > 0 && <Badge>{t.medsCount(e.medications.length)}</Badge>}
          {e.lab_observations.length > 0 && (
            <Badge tone={flagged ? "high" : "neutral"}>
              {t.testsCount(e.lab_observations.length, flagged)}
            </Badge>
          )}
        </span>
        <ArrowUpRight
          size={16}
          className="shrink-0 text-fg-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg"
        />
      </button>
    </li>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-14" aria-busy="true">
      <div className="flex items-end gap-6">
        <Skeleton className="h-28 w-24" />
        <div className="space-y-2 pb-2">
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-60 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

function findingsSentence(obs: { test_name: string; flag: string }[]) {
  const short = (n: string) =>
    n.replace(/\s*\(.*?\)\s*/g, " ").replace(/^(25-OH|Total|Serum)\s+/i, "").trim();
  const group = (flag: string) =>
    obs.filter((o) => (flag === "LOW" ? o.flag === "LOW" : o.flag !== "LOW")).map((o) => short(o.test_name));
  const lows = group("LOW"),
    highs = group("HIGH");
  const part = (xs: string[], word: string) =>
    xs.length ? (
      <span>
        {xs.map((x, i) => (
          <span key={x}>
            <mark className="hl">{x}</mark>
            {i < xs.length - 2 ? ", " : i === xs.length - 2 ? " and " : ""}
          </span>
        ))}{" "}
        {xs.length === 1 ? "is" : "are"} <span className="text-high">{word}</span>.{" "}
      </span>
    ) : null;
  return (
    <>
      {part(lows, "low")}
      {part(highs, "high")}
    </>
  );
}

/** One line that says what stands out. Sits under the name in the patient header. */
export function Findings({ records }: { records: HealthRecord[] | null }) {
  const { t, lang } = useI18n();
  if (!records) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-96 max-w-full" />
      </div>
    );
  }
  const tests = latestTests(records);
  const out = tests.filter(({ o }) => isOut(o.flag));
  const meds = currentMedicines(records);
  const own = records.filter((r) => r.name_check !== "mismatch");
  const activePool = own.length > 0 ? own : records;
  const conditions = Array.from(
    new Map(
      activePool
        .flatMap((r) => r.extracted.diagnoses)
        .map((d) => {
          const clean = tidyCondition(d);
          return [clean.toLowerCase(), clean];
        })
    ).values()
  );

  let headline: React.ReactNode;
  if (records.length === 0) {
    headline = t.heroEmpty;
  } else if (out.length > 0) {
    headline =
      lang === "en" ? (
        findingsSentence(out.map(({ o }) => o))
      ) : (
        <>
          <span className="text-high">{out.length}</span> {t.heroOut(out.length)}
        </>
      );
  } else if (conditions.length > 0 && meds.length > 0) {
    headline = (
      <span>
        {t.activeCareLead}{" "}
        <span className="text-accent">
          {conditions.slice(0, 2).join(" & ")}
          {conditions.length > 2 ? ` +${conditions.length - 2}` : ""}
        </span>{" "}
        · {t.medsCount(meds.length)}
      </span>
    );
  } else if (meds.length > 0) {
    headline = (
      <span>{t.medsPrescribed(meds.length)}</span>
    );
  } else if (tests.length > 0) {
    headline = t.heroClear;
  } else {
    headline = t.heroClear;
  }

  return (
    <div>
      <h2 className="display max-w-2xl text-[20px] sm:text-[26px] md:text-[30px] font-semibold leading-[1.25] break-words">
        {headline}
      </h2>
      <p className="mt-2 text-sm text-fg-3">
        {t.heroSub(tests.length, meds.length, records.length)}
      </p>
    </div>
  );
}
