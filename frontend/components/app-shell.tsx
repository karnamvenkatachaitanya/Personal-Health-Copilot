"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cachedImage } from "@/lib/image-cache";
import { useI18n } from "@/lib/i18n";
import type { FileUrls, HealthRecord, Profile, Trend } from "@/lib/types";
import { TopBar } from "./top-bar";
import { FamilyRow } from "./family-row";
import { PatientHeader } from "./patient-header";
import { Findings, Overview } from "./overview";
import { UploadCta } from "./upload-cta";
import { RecordsView } from "./records-view";
import { MedicinesView } from "./medicines-view";
import { AskView } from "./ask-view";
import { RecordDetail } from "./record-detail";
import { UploadPanel } from "./upload-panel";
import { Button, ErrorNote, Skeleton, cx, useToast } from "./ui";
import { MemberForm } from "./sidebar";
import { VisitSummary } from "./visit-summary";
import { CarePlanView } from "./care-plan";
import { useDoseReminders } from "./use-dose-reminders";
import { EmergencyIdModal } from "./emergency-id-modal";
import { McpGovernanceModal } from "./mcp-governance-modal";

export type Tab = "overview" | "records" | "medicines" | "care" | "ask";
const byDate = (a: HealthRecord, b: HealthRecord) => (b.record_date || "").localeCompare(a.record_date || "") || b.created_at.localeCompare(a.created_at);

export function AppShell({ email }: { email: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [allRecords, setAllRecords] = useState<HealthRecord[] | null>(null);
  const [fileUrls, setFileUrls] = useState<FileUrls>({});
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [visit, setVisit] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [trends, setTrends] = useState<Record<string, Trend[]>>({});

  const [justUploadedRecord, setJustUploadedRecord] = useState<HealthRecord | null>(null);
  const [askQuery, setAskQuery] = useState<string | null>(null);

  // Everything for the whole family in two parallel calls; switching people is then instant.
  const inflight = useRef(false);
  const loadAll = useCallback(async (select?: string) => {
    if (inflight.current) return;
    inflight.current = true;
    setLoadError(null); setRecordsError(null);
    try {
      const [ps, recs] = await Promise.all([api.profiles(), api.records()]);
      setProfiles(ps);
      setAllRecords(recs.sort(byDate));
      setActiveId((cur) => select || (cur && ps.some((p) => p.id === cur) ? cur : ps[0]?.id || null));
      api.fileUrls().then(({ urls }) => setFileUrls(urls)).catch(() => {});
    } catch (e) { setLoadError((e as Error).message); }
    finally { inflight.current = false; }
  }, []);
  const loadProfiles = loadAll;
  useEffect(() => { loadAll(); }, [loadAll]);

  const records = useMemo(() => (allRecords ? allRecords.filter((r) => r.profile_id === activeId) : null), [allRecords, activeId]);
  useDoseReminders(profiles);
  const refreshUrls = useCallback(() => { api.fileUrls().then(({ urls }) => setFileUrls(urls)).catch(() => {}); }, []);

  // Warm the browser cache with this person's document previews so a record opens with its page already there.
  useEffect(() => {
    if (!records) return;
    records.slice(0, 6).forEach((r) => {
      const u = fileUrls[r.id]?.preview || (r.source_mime !== "application/pdf" ? fileUrls[r.id]?.original : null);
      if (u) cachedImage(u).catch(() => {});
    });
  }, [records, fileUrls]);

  // Trends are computed server-side (same rules the copilot uses); refetch when this person's records change.
  const recordKey = records ? records.map((r) => r.id).join(",") : null;
  useEffect(() => {
    if (!activeId || recordKey === null) return;
    let live = true;
    api.trends(activeId).then((ts) => { if (live) setTrends((m) => ({ ...m, [activeId]: ts })); }).catch(() => {});
    return () => { live = false; };
  }, [activeId, recordKey]);

  const active = useMemo(() => profiles?.find((p) => p.id === activeId) || null, [profiles, activeId]);
  const selected = records?.find((r) => r.id === openRecord) || null;

  function select(id: string) { setActiveId(id); setOpenRecord(null); setUploading(false); setVisit(false); setEmergencyOpen(false); setJustUploadedRecord(null); setTab("overview"); }
  function openRec(id: string) { setOpenRecord(id); setVisit(false); setEmergencyOpen(false); setTab("records"); window.scrollTo({ top: 0 }); }
  function startUpload(f: File) { setUploadFile(f); setUploading(true); setOpenRecord(null); setVisit(false); setEmergencyOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function handleAsk(query: string) {
    setAskQuery(query);
    setTab("ask");
    setOpenRecord(null);
    setVisit(false);
    setEmergencyOpen(false);
    setUploading(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function upsert(rec: HealthRecord) {
    setAllRecords((rs) => [rec, ...(rs || []).filter((r) => r.id !== rec.id)].sort(byDate));
    refreshUrls();
  }

  return (
    <div className="min-h-[100dvh] flex flex-col justify-between">
      <div>
        <TopBar email={email} onOpenMcpGovernance={() => setMcpOpen(true)} />
        {profiles?.length !== 0 && <FamilyRow profiles={profiles} activeId={activeId} onSelect={select} onProfilesChanged={loadProfiles} />}
        {!profiles && !loadError && <HeaderSkeleton />}
      </div>
      <main className="min-w-0 flex-1 flex flex-col">
        {loadError && <div className="p-6"><ErrorNote message={loadError} onRetry={() => loadProfiles()} retryLabel={t.tryAgain} /></div>}
        {profiles && profiles.length === 0 && <FirstRun onDone={(id) => loadProfiles(id)} />}
        {active && (
          <>
            <div>
            <PatientHeader profile={active} tab={tab} onTab={(x) => { setTab(x); setOpenRecord(null); setVisit(false); }}
              recordCount={records?.length} onUpload={() => { setUploadFile(null); setUploading(true); setOpenRecord(null); setVisit(false); }}
              onProfile={async (p) => { await loadAll(p.id); }}
              onVisit={() => { setVisit(true); setOpenRecord(null); setUploading(false); setTab("overview"); }}
              onEmergency={() => setEmergencyOpen(true)}
              onRemove={async () => {
                if (!window.confirm(t.confirmRemove(active.name))) return;
                try { await api.deleteProfile(active.id); toast(t.removed(active.name)); await loadAll(); } catch (e) { toast((e as Error).message, "error"); }
              }}
              findings={tab === "ask" ? undefined : <Findings records={records} />}
              cta={tab === "ask" ? undefined : <UploadCta name={active.name} onFile={startUpload} />} />
            </div>
            <div className={cx(
              "mx-auto w-full max-w-[1240px] px-4 sm:px-6",
              tab === "ask" ? "pt-2 pb-2 flex-1 flex flex-col min-h-0" : "pb-12 pt-5 flex-1 flex flex-col justify-between"
            )}>
              {uploading && (
                <UploadPanel profile={active} file={uploadFile} onClose={() => { setUploading(false); setUploadFile(null); }}
                  onFiled={(rec) => {
                    upsert(rec);
                    setUploading(false);
                    setUploadFile(null);
                    setJustUploadedRecord(rec);
                    setOpenRecord(null);
                    setVisit(false);
                    setTab("overview");
                    loadProfiles(active.id);
                    toast(t.rxAnalyzedBanner);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }} />
              )}
              {recordsError ? <ErrorNote message={recordsError} onRetry={() => loadAll(active.id)} retryLabel={t.tryAgain} />
                : visit ? <VisitSummary profile={active} records={records || []} onBack={() => setVisit(false)} />
                : selected ? (
                  <RecordDetail record={selected} urls={fileUrls[selected.id]} profiles={profiles || []} active={active} onBack={() => setOpenRecord(null)}
                    onMoved={(rec, to) => { upsert(rec); setOpenRecord(null); toast(t.filed(to.name)); }}
                    onDeleted={(id) => { setAllRecords((rs) => (rs || []).filter((r) => r.id !== id)); setOpenRecord(null); }}
                    onProfileCreated={() => loadProfiles(active.id)}
                    onAsk={handleAsk} />
                ) : tab === "overview" ? (
                  <Overview
                    records={records}
                    profile={active}
                    trends={trends[active.id] || []}
                    onOpen={openRec}
                    onTab={setTab}
                    onFile={startUpload}
                    justUploaded={justUploadedRecord}
                    onDismissJustUploaded={() => setJustUploadedRecord(null)}
                    onAsk={handleAsk}
                  />
                ) : tab === "records" ? <RecordsView records={records} onOpen={openRec} />
                : tab === "medicines" ? <MedicinesView records={records} onOpen={openRec} onAsk={handleAsk} />
                : tab === "care" ? <CarePlanView profile={active} onOpen={openRec} />
                : (
                  <AskView
                    profile={active}
                    records={records || []}
                    onOpen={openRec}
                    initialQuery={askQuery}
                    onClearInitialQuery={() => setAskQuery(null)}
                  />
                )}
              {tab !== "ask" && (
                <p className="mt-12 flex flex-wrap justify-between gap-2 border-t border-line pt-4 text-xs text-fg-3"><span>{t.disclaimer}</span><span className="font-medium text-fg-2">{t.emergency}</span></p>
              )}
            </div>
            {emergencyOpen && (
              <EmergencyIdModal
                profile={active}
                records={records || []}
                onClose={() => setEmergencyOpen(false)}
              />
            )}
            {mcpOpen && (
              <McpGovernanceModal
                email={email}
                profiles={profiles || []}
                onClose={() => setMcpOpen(false)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function HeaderSkeleton() {
  // Mirrors the overview layout so the page takes shape while the family loads.
  return (
    <div className="mx-auto max-w-[1240px] overflow-hidden px-4 pt-6 sm:px-6" aria-busy="true" aria-label="Loading">
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col justify-between gap-6">
          <div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-12 w-72 max-w-full" />
            <div className="mt-4 flex flex-wrap gap-2"><Skeleton className="h-9 w-28 rounded-full" /><Skeleton className="h-9 w-40 rounded-full" /><Skeleton className="h-9 w-32 rounded-full" /></div>
          </div>
          <div><Skeleton className="h-9 w-[28rem] max-w-full" /><Skeleton className="mt-3 h-4 w-44" /></div>
        </div>
        <Skeleton className="h-[200px] rounded-xl" />
      </div>
      <div className="mt-6 flex gap-5 border-b border-line pb-3">{["w-16", "w-20", "w-20", "w-10"].map((w, i) => <Skeleton key={i} className={`h-4 ${w}`} />)}</div>
      <Skeleton className="mt-8 h-5 w-32" />
      <div className="mt-4 grid overflow-hidden rounded-xl border border-line bg-surface/60 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="space-y-3 p-5"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-32" /><Skeleton className="h-3 w-40" /></div>)}
      </div>
      <Skeleton className="mt-10 h-5 w-36" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="space-y-4 rounded-xl border border-line bg-surface/60 p-5"><div className="flex justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-14 rounded-full" /></div><Skeleton className="h-14 w-32" /><Skeleton className="h-1.5 w-full rounded-full" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>)}
      </div>
    </div>
  );
}

function FirstRun({ onDone }: { onDone: (select?: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-10 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h1 className="display text-[40px] font-semibold leading-[1] sm:text-[52px]">{t.emptyFamily}</h1>
          <p className="mt-3 max-w-md text-fg-2">{t.startBody}</p>
          <div className="panel mt-6 max-w-md p-2">
            <p className="px-3 pt-2 text-sm font-medium">{t.addYourself}</p>
            <MemberForm initialRelation="Self" onDone={(p) => { if (p) onDone(p.id); }} hideCancel />
          </div>
          <Button variant="ghost" className="mt-3" loading={busy} onClick={async () => { setBusy(true); try { await api.loadSample(); } finally { setBusy(false); onDone(); } }}>{t.loadSample}</Button>
        </div>
        <ol className="grid gap-3 self-start">
          {t.steps.map(([title, body], i) => (
            <li key={i} className="panel flex gap-4 p-5">
              <span className="display grid h-9 w-9 shrink-0 place-items-center rounded-full bg-subtle text-[17px] font-semibold">{i + 1}</span>
              <span><span className="block font-medium">{title}</span><span className="mt-1 block text-sm leading-relaxed text-fg-3">{body}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
