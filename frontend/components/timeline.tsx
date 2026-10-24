"use client";
import { ArrowUpRight } from "@phosphor-icons/react";
import { isOut, tidyName } from "@/lib/clinical";
import { formatDate, useI18n } from "@/lib/i18n";
import { pick, type HealthRecord } from "@/lib/types";
import { DocIcon } from "./doc-icon";
import { highlight, termVariants } from "@/lib/highlight";
import { Badge } from "./ui";

/** Chronological health journey grouped by month, newest first. */
export function Timeline({ records, onOpen, limit }: { records: HealthRecord[]; onOpen: (id: string) => void; limit?: number }) {
  const { t, lang } = useI18n();
  const list = limit ? records.slice(0, limit) : records;
  const loc = lang === "hi" ? "hi-IN" : lang === "te" ? "te-IN" : "en-IN";
  const groups: { key: string; label: string; items: HealthRecord[] }[] = [];
  for (const r of list) {
    const key = r.record_date ? r.record_date.slice(0, 7) : "none";
    const label = r.record_date ? new Date(`${r.record_date}T00:00:00`).toLocaleDateString(loc, { month: "long", year: "numeric" }) : t.noDate;
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(r); else groups.push({ key, label, items: [r] });
  }
  return (
    <ol className="relative">
      <span aria-hidden className="absolute bottom-2 left-[15px] top-2 w-px bg-line" />
      {groups.map((g) => (
        <li key={g.key} className="relative pb-6 last:pb-0">
          <p className="eyebrow relative mb-3 ml-11">{g.label}</p>
          <ol className="space-y-3">
            {g.items.map((r) => {
              const e = r.extracted;
              const flagged = e.lab_observations.filter((o) => isOut(o.flag)).length;
              return (
                <li key={r.id} className="relative pl-11">
                  <span className="absolute left-0 top-4 rounded-md ring-4 ring-canvas"><DocIcon type={r.document_type} /></span>
                  <button onClick={() => onOpen(r.id)}
                    className="group block w-full panel p-4 text-left transition-all hover:-translate-y-0.5 hover:border-fg/30">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-[15px] font-medium">{t.types[r.document_type]} <span className="font-normal text-fg-3">· {tidyName(e.facility_name) || e.doctor_name || r.source_filename}</span></p>
                      <span className="num flex items-center gap-1.5 text-xs text-fg-3">{r.record_date ? formatDate(r.record_date, lang) : t.noDate}<ArrowUpRight size={13} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></span>
                    </div>
                    <p className="mt-2 line-clamp-2 max-w-[75ch] text-sm leading-relaxed text-fg-2">{highlight(pick(e.summary, lang), [...e.lab_observations.filter((o) => isOut(o.flag)).flatMap((o) => termVariants(o.test_name)), ...e.diagnoses.map((d) => d.replace(/\s*\[.*\]/, ""))])}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(r.source_filename?.startsWith("ABHA:") || r.extraction?.engine === "abdm_gateway") && (
                        <span className="inline-flex items-center gap-1 rounded bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">
                          ABHA Record
                        </span>
                      )}
                      {r.name_check === "mismatch" && <Badge tone="warn">{t.nameDiffers}</Badge>}
                      {e.diagnoses.slice(0, 3).map((d, i) => <Badge key={i} tone="accent">{d.replace(/\s*\[.*\]/, "")}</Badge>)}
                      {e.medications.length > 0 && <Badge>{t.medsCount(e.medications.length)}</Badge>}
                      {e.lab_observations.length > 0 && <Badge tone={flagged ? "high" : "neutral"}>{t.testsCount(e.lab_observations.length, flagged)}</Badge>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}
