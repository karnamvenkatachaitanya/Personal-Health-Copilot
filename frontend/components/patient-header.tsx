"use client";
import { useState } from "react";
import { ArrowUpRight, DownloadSimple, FirstAid, IdentificationCard, Printer, Sparkle, UserMinus } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { ageLabel, relationLabel, useI18n } from "@/lib/i18n";
import type { Profile } from "@/lib/types";
import type { Tab } from "./app-shell";
import { Badge, Button, cx, useToast } from "./ui";

export function PatientHeader({ profile, tab, onTab, recordCount, onUpload, onProfile, findings, cta, onVisit, onEmergency, onRemove }: {
  profile: Profile; tab: Tab; onTab: (t: Tab) => void; recordCount?: number; onUpload: () => void; onProfile: (p: Profile) => void; findings?: React.ReactNode; cta?: React.ReactNode; onVisit?: () => void; onEmergency?: () => void; onRemove?: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [abhaOpen, setAbhaOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const tabs: Tab[] = ["overview", "care", "records", "medicines", "ask"];
  const chip = "!h-11 text-[13px] sm:!h-9";
  return (
    <section className="mx-auto max-w-[1240px] px-4 pt-4 sm:pt-5 sm:px-6">
      <div className={cx(
        "items-stretch gap-4",
        cta ? "grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : "flex flex-wrap items-center justify-between"
      )}>
        <div className="flex min-w-0 flex-col justify-between gap-3.5">
          <div>
            <p className="flex items-center gap-1.5 text-xs text-fg-3">
              {relationLabel(profile.relation, lang)}{profile.age ? ` · ${ageLabel(profile.age, lang)}` : ""}{profile.sex ? ` · ${profile.sex}` : ""}
              {profile.is_sample && <Badge className="py-0 text-[11px]">{t.sample}</Badge>}
            </p>
            <h1 className="display mt-1 truncate text-[28px] font-bold leading-tight sm:text-[36px]">{profile.name}</h1>
            {/* Visit summary and Emergency ID first: they serve the caregiver at the clinic. Record-keeping actions follow. */}
            <div className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 pb-1 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              {onVisit && <Button size="sm" className={chip} icon={<Printer size={14} aria-hidden />} onClick={onVisit}>{t.visitSummary}</Button>}
              {onEmergency && (
                <button type="button" onClick={onEmergency}
                  className={cx(chip, "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-high/35 bg-high-soft px-3.5 font-semibold text-high transition-colors hover:bg-high/15 active:scale-[.98]")}>
                  <FirstAid size={14} weight="fill" aria-hidden />
                  {t.emergencyId}
                </button>
              )}
              {profile.abha_linked ? (
                <button onClick={() => setAbhaOpen((v) => !v)} aria-expanded={abhaOpen} className={cx(chip, "flex shrink-0 items-center gap-1.5 rounded-full border border-line pl-1 pr-3 hover:border-fg/40")}>
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-ok-soft text-ok"><IdentificationCard size={13} weight="fill" aria-hidden /></span>
                  <span className="num text-fg">{profile.abha_number || profile.abha_address}</span>
                  <span className="text-[11px] text-fg-3">ABHA</span>
                </button>
              ) : (
                <button onClick={() => setAbhaOpen((v) => !v)} aria-expanded={abhaOpen} className={cx(chip, "flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3.5 text-fg-2 hover:border-fg hover:text-fg")}>
                  <IdentificationCard size={14} aria-hidden /> {t.abhaLink}
                </button>
              )}
              <Button size="sm" className={chip} loading={exporting} icon={<DownloadSimple size={14} aria-hidden />} onClick={async () => {
                setExporting(true);
                try { await api.exportFhir(profile.id, profile.name); } catch (e) { toast((e as Error).message, "error"); }
                setExporting(false);
              }}>{t.exportAbdm}</Button>
              {onRemove && <Button size="sm" variant="ghost" className={cx(chip, "w-11 px-0 text-fg-3 hover:text-high sm:w-9")} icon={<UserMinus size={15} aria-hidden />} onClick={onRemove} aria-label={t.removeMember} title={t.removeMember} />}
            </div>
          </div>
          {findings}
        </div>
        {cta}
      </div>
      {abhaOpen && <AbhaForm profile={profile} onDone={(p) => { if (p) onProfile(p); setAbhaOpen(false); }} />}
      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-line sm:mt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Sections">
        {tabs.map((x) => (
          <button key={x} onClick={() => onTab(x)} aria-current={tab === x ? "page" : undefined}
            className={cx("relative -mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors sm:min-h-10 sm:text-[15px]",
              tab === x ? "border-fg font-semibold text-fg" : "border-transparent text-fg-3 hover:text-fg")}>
            {t.tabs[x]}{x === "records" && recordCount !== undefined && <span className="num ml-1 text-[11px] text-fg-3">{recordCount}</span>}
          </button>
        ))}
      </nav>
    </section>
  );
}

function AbhaForm({ profile, onDone }: { profile: Profile; onDone: (p: Profile | null) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [num, setNum] = useState("");
  const [addr, setAddr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoFilled, setDemoFilled] = useState(false);
  const f = "h-10 rounded-full border border-line bg-canvas px-4 text-[14px] text-fg placeholder:text-fg-3 focus:border-fg focus:outline-none";

  const getDemoData = () => {
    const raw = profile.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "patient";
    const username = raw.length < 3 ? `${raw}123` : raw;
    return {
      number: "91-1234-5678-9012",
      address: `${username}@abdm`,
    };
  };

  const handleFillDemo = () => {
    const demo = getDemoData();
    setNum(demo.number);
    setAddr(demo.address);
    setErr(null);
    setDemoFilled(true);
    toast("Demo credentials filled into fields. Click Link ABHA to fetch records.");
  };

  if (profile.abha_linked) {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-line/10 p-4 text-sm">
        <div>
          <p className="font-semibold text-fg">
            {t.abhaLinked}: <span className="font-mono text-ok">{profile.abha_number || profile.abha_address}</span>
          </p>
          <p className="mt-1 text-xs text-fg-3">
            Unlinking will safely remove all ABDM-imported documents from the timeline while keeping your manual uploads intact.
          </p>
        </div>
        <Button
          size="sm"
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const p = await api.unlinkAbha(profile.id);
              toast("ABHA unlinked. ABDM records removed.");
              onDone(p);
            } catch (e) {
              toast((e as Error).message, "error");
              setBusy(false);
            }
          }}
        >
          {t.abhaUnlink}
        </Button>
      </div>
    );
  }
  return (
    <form className="mt-5 rounded-xl border border-line bg-canvas/60 p-4 shadow-sm" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr(null);
      try {
        const p = await api.linkAbha(profile.id, { abha_number: num || undefined, abha_address: addr || undefined });
        toast("ABHA linked! Fetched ABDM records into health timeline.");
        onDone(p);
      } catch (x) {
        setErr((x as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-fg-3">{t.abhaHelp}</p>
        <button
          type="button"
          onClick={handleFillDemo}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft/30 px-3 py-1 text-xs font-semibold text-accent transition-colors hover:border-accent hover:bg-accent-soft cursor-pointer"
        >
          <Sparkle size={13} weight="fill" />
          Auto-fill Demo Credentials
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={num}
          onChange={(e) => { setNum(e.target.value); setDemoFilled(false); }}
          placeholder="91-1234-5678-9012"
          inputMode="numeric"
          aria-label={t.abhaNumber}
          className={`${f} num w-56`}
        />
        <input
          value={addr}
          onChange={(e) => { setAddr(e.target.value); setDemoFilled(false); }}
          placeholder="name@abdm"
          aria-label={t.abhaAddress}
          className={`${f} w-48`}
        />
        <Button variant="primary" loading={busy} icon={<ArrowUpRight size={15} />}>
          {busy ? "Connecting & Fetching Records..." : t.abhaLink}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>{t.cancel}</Button>
      </div>
      {demoFilled && (
        <p className="mt-2 text-xs text-ok flex items-center gap-1">
          ✓ Sample credentials populated. Click <strong>Link ABHA</strong> to fetch and sync clinical records.
        </p>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-high">{err}</p>}
    </form>
  );
}
