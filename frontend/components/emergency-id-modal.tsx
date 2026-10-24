"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AddressBook,
  CaretDown,
  Check,
  Copy,
  DeviceMobile,
  DownloadSimple,
  Drop,
  FirstAid,
  Heartbeat,
  IdentificationBadge,
  IdentificationCard,
  PhoneCall,
  Printer,
  QrCode as QrIcon,
  ShieldCheck,
  ShieldWarning,
  WarningOctagon,
  X,
} from "@phosphor-icons/react";
import { currentMedicines, tidyName } from "@/lib/clinical";
import { ageLabel, relationLabel, useI18n } from "@/lib/i18n";
import type { HealthRecord, Profile } from "@/lib/types";
import { Badge, Button, cx, useToast } from "./ui";
import { QrCode } from "./qr-code";

interface EmergencyIdModalProps {
  profile: Profile;
  records: HealthRecord[];
  onClose: () => void;
}

const BLOOD_GROUPS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-", "Unknown"];

function detectBloodGroup(records: HealthRecord[]): string {
  for (const r of records) {
    for (const obs of r.extracted?.lab_observations || []) {
      const name = (obs.test_name || "").toLowerCase();
      if (name.includes("blood group") || name.includes("rh type") || name.includes("abo") || name === "blood type") {
        const val = (obs.observed_value || "").trim().toUpperCase();
        for (const bg of BLOOD_GROUPS) {
          if (bg !== "Unknown" && (val === bg || val.startsWith(bg))) return bg;
        }
      }
    }
  }
  return "Unknown";
}

function detectAllergies(records: HealthRecord[]): string[] {
  const found: string[] = [];
  records.forEach((r) => {
    (r.extracted?.diagnoses || []).forEach((d) => {
      if (/allerg|reaction|sensitivity|hypersensitiv/i.test(d)) {
        found.push(d);
      }
    });
  });
  return Array.from(new Set(found));
}

export function EmergencyIdModal({ profile, records, onClose }: EmergencyIdModalProps) {
  const { lang, t } = useI18n();
  const toast = useToast();

  const storageKey = `emergency_id_${profile.id}`;

  // Blood group and allergies come from this person's own records when they are printed there;
  // nothing is invented. Contact and organ-donor status start empty until the family fills them in.
  const ownRecords = records.filter((r) => r.name_check !== "mismatch");
  const [bloodGroup, setBloodGroup] = useState<string>(() => detectBloodGroup(ownRecords));
  const [allergies, setAllergies] = useState<string[]>(() => detectAllergies(ownRecords));
  const [newAllergy, setNewAllergy] = useState("");
  const [iceName, setIceName] = useState("");
  const [icePhone, setIcePhone] = useState("");
  const [organDonor, setOrganDonor] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "lockscreen">("card");
  const [copied, setCopied] = useState(false);
  const [bloodDropdownOpen, setBloodDropdownOpen] = useState(false);
  const [now] = useState(() => new Date());
  const bloodDropdownRef = useRef<HTMLDivElement>(null);

  // Close blood dropdown on click outside
  useEffect(() => {
    if (!bloodDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (bloodDropdownRef.current && !bloodDropdownRef.current.contains(e.target as Node)) {
        setBloodDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [bloodDropdownOpen]);

  // Load persisted emergency info
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.bloodGroup) setBloodGroup(parsed.bloodGroup);
        if (parsed.allergies) setAllergies(parsed.allergies);
        if (parsed.iceName) setIceName(parsed.iceName);
        if (parsed.icePhone) setIcePhone(parsed.icePhone);
        if (parsed.organDonor !== undefined) setOrganDonor(parsed.organDonor);
      } else {
        const detectedBg = detectBloodGroup(ownRecords);
        if (detectedBg !== "Unknown") setBloodGroup(detectedBg);
        const detectedAllergiesList = detectAllergies(ownRecords);
        if (detectedAllergiesList.length > 0) setAllergies(detectedAllergiesList);
      }
    } catch {}
  }, [storageKey, records]);

  function persist(updates: Partial<{ bloodGroup: string; allergies: string[]; iceName: string; icePhone: string; organDonor: boolean }>) {
    try {
      const current = { bloodGroup, allergies, iceName, icePhone, organDonor, ...updates };
      localStorage.setItem(storageKey, JSON.stringify(current));
    } catch {}
  }

  const activeMeds = useMemo(() => currentMedicines(records.filter((r) => r.name_check !== "mismatch")), [records]);

  // Only documents with this person's own name: a misfiled report must not put someone
  // else's condition on an emergency card.
  const own = useMemo(() => records.filter((r) => r.name_check !== "mismatch"), [records]);

  const conditions = useMemo(() => {
    const set = new Set<string>();
    own.forEach((r) => r.extracted.diagnoses.forEach((d) => set.add(d)));
    return Array.from(set);
  }, [own]);

  const primaryDoctor = useMemo(() => {
    for (const r of own) {
      if (r.extracted.doctor_name || r.extracted.facility_name) {
        return {
          doctor: r.extracted.doctor_name || "",
          facility: r.extracted.facility_name ? tidyName(r.extracted.facility_name) : "",
        };
      }
    }
    return { doctor: "", facility: "" };
  }, [own]);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Only facts that are on file or entered by the family; unset fields are left out, never guessed.
  const emergencySummaryText = useMemo(() => {
    const lines = [
      "EMERGENCY MEDICAL ID",
      `Patient: ${[profile.name, profile.age ? ageLabel(profile.age, lang) : "", profile.sex || ""].filter(Boolean).join(", ")}`,
      bloodGroup !== "Unknown" ? `Blood group: ${bloodGroup}` : "",
      organDonor ? "Organ donor: YES" : "",
      profile.abha_number ? `ABHA: ${profile.abha_number}` : "",
      allergies.length ? `Allergies: ${allergies.join(", ")}` : "",
      conditions.length ? `Conditions: ${conditions.slice(0, 3).join(", ")}` : "",
      activeMeds.length ? `Medicines: ${activeMeds.slice(0, 4).map(({ m }) => `${m.name} ${m.dosage || ""}`.trim()).join(", ")}` : "",
      icePhone ? `Emergency contact: ${iceName ? `${iceName} ` : ""}${icePhone}` : "",
      primaryDoctor.facility ? `Hospital: ${primaryDoctor.facility}` : "",
      "National emergency: 112 / 108",
    ];
    return lines.filter(Boolean).join("\n");
  }, [profile, bloodGroup, organDonor, allergies, conditions, activeMeds, iceName, icePhone, primaryDoctor, lang]);

  function handleCopy() {
    navigator.clipboard.writeText(emergencySummaryText);
    setCopied(true);
    toast(t.emCopied);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleAddAllergy() {
    if (!newAllergy.trim()) return;
    const updated = [...allergies, newAllergy.trim()];
    setAllergies(updated);
    persist({ allergies: updated });
    setNewAllergy("");
  }

  function handleRemoveAllergy(index: number) {
    const updated = allergies.filter((_, i) => i !== index);
    setAllergies(updated);
    persist({ allergies: updated });
  }

  const initials = useMemo(() => {
    return profile.name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }, [profile.name]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="relative w-full max-w-[820px] max-h-[94vh] flex flex-col overflow-hidden rounded-3xl border border-line bg-surface text-fg shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t.emergencyId}
      >
        {/* ================= MODAL TOP NAVIGATION BAR ================= */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <FirstAid size={18} weight="fill" className="shrink-0 text-high" aria-hidden />
            <h2 className="truncate text-[15px] font-semibold text-fg">{t.emergencyId}</h2>
          </div>

          <div className="order-last flex w-full items-center sm:order-none sm:w-auto">
            {/* View Switcher Pill */}
            <div className="flex w-full rounded-full border border-line bg-canvas p-0.5 text-[13px] sm:w-auto" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "card"}
                onClick={() => setViewMode("card")}
                className={cx(
                  "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 font-medium transition-colors sm:flex-none",
                  viewMode === "card" ? "bg-accent text-accent-fg" : "text-fg-3 hover:text-fg"
                )}
              >
                <IdentificationCard size={14} aria-hidden /> {t.emPassCard}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "lockscreen"}
                onClick={() => setViewMode("lockscreen")}
                className={cx(
                  "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 font-medium transition-colors sm:flex-none",
                  viewMode === "lockscreen" ? "bg-accent text-accent-fg" : "text-fg-3 hover:text-fg"
                )}
              >
                <DeviceMobile size={14} aria-hidden /> {t.emLockScreen}
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-fg-3 transition-colors hover:bg-hover hover:text-fg"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ================= MODAL SCROLLABLE BODY ================= */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-6">
          {viewMode === "lockscreen" ? (
            /* ================= PHONE LOCKSCREEN MOCKUP ================= */
            <div className="mx-auto max-w-[340px] rounded-[42px] border-[7px] border-line-strong bg-canvas p-4 shadow-2xl relative overflow-hidden ring-1 ring-line">
              {/* Dynamic Island Speaker */}
              <div className="mx-auto h-4 w-28 rounded-full bg-line-strong/60 mb-4 shadow-inner" />

              {/* Lockscreen Time */}
              <div className="text-center my-3">
                <p className="text-[11px] font-semibold text-high">{t.emPass}</p>
                <p className="display mt-1 text-5xl font-bold tracking-tight text-fg num">{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>
                <p className="mt-0.5 text-xs font-medium text-fg-3">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
              </div>

              {/* Emergency Widget on Lockscreen */}
              <div className="mt-5 rounded-2xl border-2 border-high/50 bg-high-soft/60 p-3.5 backdrop-blur-xl shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-high">
                    <WarningOctagon size={16} weight="fill" /> Medical ID
                  </div>
                  {bloodGroup !== "Unknown" && (
                    <span className="rounded-lg bg-high px-2 py-0.5 text-xs font-bold text-white">
                      {bloodGroup}
                    </span>
                  )}
                </div>

                <div className="mt-2.5">
                  <p className="font-extrabold text-base leading-tight text-fg">{profile.name}</p>
                  <p className="text-[11px] text-fg-3 mt-0.5 font-medium">
                    {ageLabel(profile.age, lang)} · {profile.sex || "N/A"} · {relationLabel(profile.relation, lang)}
                  </p>
                </div>

                {/* Allergies on Lockscreen */}
                <div className="mt-3 pt-2.5 border-t border-line/60">
                  <p className="text-[11px] font-semibold text-high">{t.emAllergies}</p>
                  <p className="text-xs font-semibold text-fg mt-0.5 leading-snug">
                    {allergies.length ? allergies.join(", ") : t.emNone}
                  </p>
                </div>

                {/* Current Meds */}
                <div className="mt-2.5 pt-2 border-t border-line/60">
                  <p className="text-[11px] font-semibold text-fg-3">{t.emMeds}</p>
                  <p className="text-[11px] text-fg-2 mt-0.5 line-clamp-2">
                    {activeMeds.length
                      ? activeMeds.slice(0, 3).map(({ m }) => `${m.name} (${m.dosage || ""})`).join(", ")
                      : t.emNone}
                  </p>
                </div>

                {/* Fast Call ICE Button */}
                {icePhone && <a
                  href={`tel:${icePhone}`}
                  className="mt-3.5 flex items-center justify-center gap-2 rounded-xl bg-high py-2.5 text-xs font-extrabold text-white shadow hover:opacity-90 transition-all active:scale-[0.98]"
                >
                  <PhoneCall size={14} weight="bold" /> {t.emCall} {iceName} ({icePhone})
                </a>}
              </div>
            </div>
          ) : (
            /* ================= THEME-ADAPTIVE EXECUTIVE PASS CARD ================= */
            <div className="space-y-4" id="printable-emergency-card">
              {/* The Master Pass Container */}
              <div className="relative overflow-hidden rounded-3xl border-2 border-high/30 bg-surface p-5 shadow-pop sm:p-7">

                {/* Top Security Banner & ECG Pulse Line */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 items-center gap-1 rounded-md border border-high/30 bg-high-soft px-2 text-[11px] font-semibold text-high">
                      <FirstAid size={11} weight="fill" /> Pass {profile.id.slice(0, 6).toUpperCase()}
                    </div>
                    {profile.abha_linked && (
                      <div className="flex h-6 items-center gap-1 rounded-md border border-ok/30 bg-ok-soft px-2 text-[11px] font-semibold text-ok">
                        <ShieldCheck size={11} weight="fill" /> ABHA linked
                      </div>
                    )}
                  </div>
                </div>

                {/* Primary Patient Info Header & Blood Group Pill */}
                <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {/* Patient Avatar Shield with Initials */}
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-high text-xl font-bold text-surface">
                      {initials}
                    </div>

                    <div>
                      <h3 className="display text-2xl font-bold leading-tight text-fg sm:text-3xl">
                        {profile.name}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-2">
                        <span className="rounded bg-subtle px-2 py-0.5 font-semibold text-fg">
                          {relationLabel(profile.relation, lang)}
                        </span>
                        <span>·</span>
                        <span>{ageLabel(profile.age, lang)}</span>
                        <span>·</span>
                        {profile.sex && <span>{profile.sex}</span>}
                        {profile.abha_number && (
                          <>
                            <span>·</span>
                            <span className="num font-mono text-ok font-bold">ABHA {profile.abha_number}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ================= THEME-MATCHED BLOOD GROUP DROPDOWN ================= */}
                  <div className="relative" ref={bloodDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setBloodDropdownOpen((prev) => !prev)}
                      className={cx(
                        "group flex items-center gap-3 rounded-2xl border px-4 py-2 text-right transition-all select-none shadow-xs",
                        bloodDropdownOpen
                          ? "border-high bg-high/15 ring-2 ring-high/30"
                          : "border-high/35 bg-high-soft hover:bg-high/20 hover:border-high/60"
                      )}
                      aria-haspopup="listbox"
                      aria-expanded={bloodDropdownOpen}
                      title="Choose blood group"
                    >
                      <div className="text-right">
                        <p className="flex items-center justify-end gap-1 text-[11px] font-semibold text-high">
                          <Drop size={11} weight="fill" className="text-high" /> {t.emBloodGroup}
                        </p>
                        <p className="num text-2xl sm:text-3xl font-black text-high leading-none mt-0.5 tracking-tight">
                          {bloodGroup === "Unknown" ? <span className="text-base font-semibold">{t.emAdd}</span> : bloodGroup}
                        </p>
                      </div>
                      <CaretDown
                        size={15}
                        weight="bold"
                        className={cx(
                          "text-high transition-transform duration-200 mt-1",
                          bloodDropdownOpen && "rotate-180"
                        )}
                      />
                    </button>

                    {/* Custom Floating Popover Menu */}
                    {bloodDropdownOpen && (
                      <div
                        role="listbox"
                        className="absolute right-0 top-full mt-2 z-50 w-60 rounded-2xl border border-line bg-surface p-3 shadow-2xl backdrop-blur-xl animate-fadeIn"
                      >
                        <div className="px-1 py-1 mb-2.5 border-b border-line flex items-center justify-between">
                          <span className="text-[13px] font-semibold text-fg-2">
                            {t.emBloodGroup}
                          </span>
                          <span className="rounded bg-high px-2 py-0.5 text-[10px] font-mono text-white font-extrabold">
                            {bloodGroup}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {BLOOD_GROUPS.map((b) => {
                            const isSelected = b === bloodGroup;
                            return (
                              <button
                                key={b}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => {
                                  setBloodGroup(b);
                                  persist({ bloodGroup: b });
                                  setBloodDropdownOpen(false);
                                }}
                                className={cx(
                                  "flex items-center justify-center rounded-xl py-2 text-xs font-black transition-all",
                                  isSelected
                                    ? "bg-high text-white shadow-xs scale-[1.03]"
                                    : "bg-canvas text-fg hover:bg-hover hover:border-high/40 border border-line"
                                )}
                              >
                                {b}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ================= MIDDLE BENTO GRID ================= */}
                <div className="mt-6 grid sm:grid-cols-2 gap-4">
                  {/* Critical Drug Allergies (Red Danger Box) */}
                  <div className="rounded-2xl border border-high/35 bg-high-soft/60 p-4 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-high">
                        <ShieldWarning size={16} weight="fill" className="text-high" /> {t.emAllergies}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {allergies.length ? (
                        allergies.map((a, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-high/15 px-2.5 py-1 text-xs font-bold text-high border border-high/30 shadow-xs"
                          >
                            <span>{a}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveAllergy(i)}
                              className="-mr-1 grid h-6 w-6 place-items-center rounded text-high transition-opacity hover:opacity-70"
                              title="Remove allergy"
                              aria-label={`Remove ${a}`}
                            >
                              <X size={12} weight="bold" />
                            </button>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-fg-3">{t.emNoAllergies}</span>
                      )}
                    </div>

                    {/* Quick Add Custom Allergy */}
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="text"
                        value={newAllergy}
                        onChange={(e) => setNewAllergy(e.target.value)}
                        placeholder={t.emAddAllergy}
                        aria-label={t.emAddAllergy}
                        onKeyDown={(e) => e.key === "Enter" && handleAddAllergy()}
                        className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:border-high focus:ring-1 focus:ring-high transition-all"
                      />
                      <button
                        type="button"
                        onClick={handleAddAllergy}
                        className="h-10 rounded-xl bg-high px-4 text-sm font-semibold text-surface transition-opacity hover:opacity-90"
                      >
                        {t.emAdd}
                      </button>
                    </div>
                  </div>

                  {/* Chronic Conditions & Organ Donor */}
                  <div className="flex flex-col justify-between rounded-2xl border border-line bg-canvas/70 p-4">
                    <div>
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg-2">
                        <Heartbeat size={16} weight="fill" className="text-high" /> {t.emConditions}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {conditions.length ? (
                          conditions.map((c, i) => (
                            <span
                              key={i}
                              className="rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-fg border border-line/60"
                            >
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-fg-3">{t.emNone}</span>
                        )}
                      </div>
                    </div>

                    {/* Organ Donor Toggle */}
                    <div className="mt-4 flex items-center justify-between pt-3 border-t border-line text-xs">
                      <span className="font-medium text-fg-3">{t.emOrganDonor}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !organDonor;
                          setOrganDonor(next);
                          persist({ organDonor: next });
                        }}
                        className={cx(
                          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all shadow-xs",
                          organDonor
                            ? "bg-ok-soft text-ok border border-ok/30"
                            : "bg-subtle text-fg-3"
                        )}
                      >
                        {organDonor ? t.emDonorYes : t.emNotStated}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ================= BOTTOM SECTION: MEDS & QR ================= */}
                <div className="mt-5 grid sm:grid-cols-[1fr_auto] gap-5 pt-5 border-t border-line items-center">
                  {/* Active Medications List */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <p className="text-[13px] font-semibold text-fg-2">
                        {t.emMeds} ({activeMeds.length})
                      </p>
                      <span className="text-[11px] text-fg-3">{t.emFromLatest}</span>
                    </div>

                    {activeMeds.length ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {activeMeds.slice(0, 4).map(({ m }, i) => (
                          <div
                            key={i}
                            className="rounded-xl border border-line bg-surface p-2.5 shadow-xs"
                          >
                            <p className="font-extrabold text-fg truncate">{m.name}</p>
                            <p className="text-[11px] text-fg-3 mt-0.5 font-medium">
                              {[m.dosage, m.frequency].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-fg-3 italic">
                        {t.emNone}
                      </p>
                    )}

                    {/* ICE Contacts Strip */}
                    <div className="mt-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-canvas p-2 text-xs">
                      <div className="flex flex-1 flex-wrap items-center gap-1.5 font-bold text-fg">
                        <AddressBook size={15} className="text-high shrink-0" aria-hidden /> <span className="sr-only">Emergency contact</span>
                        <input
                          type="text"
                          value={iceName}
                          onChange={(e) => {
                            setIceName(e.target.value);
                            persist({ iceName: e.target.value });
                          }}
                          placeholder={t.emContactName}
                          aria-label={t.emContactName}
                          className="h-9 flex-1 min-w-[100px] rounded-lg border border-line bg-surface px-2 text-xs font-semibold text-fg placeholder:font-normal placeholder:text-fg-3 focus:border-high focus:outline-none"
                        />
                        <input
                          type="tel"
                          value={icePhone}
                          onChange={(e) => {
                            setIcePhone(e.target.value);
                            persist({ icePhone: e.target.value });
                          }}
                          placeholder={t.emContactPhone}
                          aria-label={t.emContactPhone}
                          className="num h-9 flex-1 min-w-[120px] rounded-lg border border-line bg-surface px-2 text-xs font-semibold text-high placeholder:font-normal placeholder:text-fg-3 focus:border-high focus:outline-none"
                        />
                      </div>
                      {icePhone && (
                        <a
                          href={`tel:${icePhone}`}
                          className="sm:ml-auto inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-high px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                        >
                          <PhoneCall size={13} weight="bold" /> {t.emCall}
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Scannable Dynamic QR Pass */}
                  <div className="relative flex flex-col items-center justify-center rounded-2xl border border-line bg-white p-3 text-center shadow-sm">
                    <QrCode value={emergencySummaryText} size={112} label={t.emScan} className="h-28 w-28 rounded-lg" />
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-black">
                      <QrIcon size={12} aria-hidden /> {t.emScan}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ================= MODAL ACTION TOOLBAR ================= */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Printer size={14} />}
              onClick={() => window.print()}
            >
              {t.emPrint}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
              onClick={handleCopy}
            >
              {copied ? t.emCopied : t.emCopy}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<DownloadSimple size={14} />}
              onClick={() => {
                toast(t.emOfflineToast);
                handleCopy();
              }}
            >
              {t.emKeepOffline}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t.emDone}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
