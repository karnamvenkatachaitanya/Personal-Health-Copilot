"use client";
import { useEffect } from "react";
import { ArrowLeft, Printer, QrCode, SpeakerHigh, Stop, WhatsappLogo } from "@phosphor-icons/react";
import { currentMedicines, isOut, latestTests, tidyName } from "@/lib/clinical";
import { formatDate, relationLabel, ageLabel, useI18n } from "@/lib/i18n";
import { pickList, type HealthRecord, type Lang, type Profile } from "@/lib/types";
import { Button, useToast } from "./ui";
import { QrCode as QrCodeImage } from "./qr-code";
import { useSpeech } from "./use-speech";

/** Build plain-language speech narration in Telugu, Hindi or English for elderly caregivers */
function buildSpeechText(
  profile: Profile,
  conditions: string[],
  meds: ReturnType<typeof currentMedicines>,
  out: ReturnType<typeof latestTests>,
  questions: string[],
  lang: Lang
): string {
  if (lang === "te") {
    const parts: string[] = [];
    parts.push(`వైద్య సంప్రదింపు సారాంశం: రోగి పేరు ${profile.name}.`);
    if (profile.age) parts.push(`వయస్సు ${profile.age} సంవత్సరాలు.`);
    if (conditions.length) {
      parts.push(`గుర్తించబడిన ఆరోగ్య సమస్యలు: ${conditions.join(", ")}.`);
    }
    if (meds.length) {
      const medList = meds.slice(0, 5).map(({ m }) => `${m.name} ${m.dosage || ""}, ${[m.frequency, m.timing].filter(Boolean).join(" ")}`).join(". ");
      parts.push(`ప్రస్తుతం వాడుతున్న మందులు ${meds.length}: ${medList}.`);
    }
    if (out.length) {
      const outList = out.slice(0, 4).map(({ o }) => `${o.test_name} ఫలితం ${o.observed_value} ${o.unit || ""}, సాధారణ పరిధి కంటే ${o.flag === "HIGH" ? "ఎక్కువ" : "తక్కువ"}`).join(". ");
      parts.push(`పరిధి దాటిన పరీక్షా విలువలు: ${outList}.`);
    }
    if (questions.length) {
      parts.push(`డాక్టర్‌ను అడగవలసిన ప్రశ్నలు: ${questions.slice(0, 3).join(". ")}.`);
    }
    parts.push("ఈ సారాంశం మీ డాక్టర్ సంప్రదింపు కోసం సిద్ధంగా ఉంది.");
    return parts.join(" ");
  }

  if (lang === "hi") {
    const parts: string[] = [];
    parts.push(`डॉक्टर विजिट सारांश: मरीज का नाम ${profile.name}.`);
    if (profile.age) parts.push(`उम्र ${profile.age} वर्ष.`);
    if (conditions.length) {
      parts.push(`स्वास्थ्य स्थितियां: ${conditions.join(", ")}.`);
    }
    if (meds.length) {
      const medList = meds.slice(0, 5).map(({ m }) => `${m.name} ${m.dosage || ""}, ${[m.frequency, m.timing].filter(Boolean).join(" ")}`).join(". ");
      parts.push(`वर्तमान दवाएं ${meds.length}: ${medList}.`);
    }
    if (out.length) {
      const outList = out.slice(0, 4).map(({ o }) => `${o.test_name} का मान ${o.observed_value} ${o.unit || ""}, ${o.flag === "HIGH" ? "अधिक" : "कम"}`).join(". ");
      parts.push(`जांच परिणाम जो सीमा से बाहर हैं: ${outList}.`);
    }
    if (questions.length) {
      parts.push(`डॉक्टर से पूछने योग्य सवाल: ${questions.slice(0, 3).join(". ")}.`);
    }
    parts.push("यह क्लिनिकल सारांश आपकी अगली डॉक्टर मुलाकात के लिए तैयार है।");
    return parts.join(" ");
  }

  // English (default)
  const parts: string[] = [];
  parts.push(`Doctor visit summary for ${profile.name}.`);
  if (profile.age) parts.push(`Age ${profile.age}.`);
  if (conditions.length) {
    parts.push(`Recorded health conditions: ${conditions.join(", ")}.`);
  }
  if (meds.length) {
    const medList = meds.slice(0, 5).map(({ m }) => `${m.name} ${m.dosage || ""}, ${[m.frequency, m.timing].filter(Boolean).join(" ")}`).join(". ");
    parts.push(`Current medications (${meds.length}): ${medList}.`);
  }
  if (out.length) {
    const outList = out.slice(0, 4).map(({ o }) => `${o.test_name} at ${o.observed_value} ${o.unit || ""}, flagged as ${o.flag.toLowerCase()}`).join(". ");
    parts.push(`Test values outside normal range: ${outList}.`);
  }
  if (questions.length) {
    parts.push(`Questions to ask the doctor: ${questions.slice(0, 3).join(". ")}.`);
  }
  parts.push("Summary prepared for your clinical consultation.");
  return parts.join(" ");
}

/** Formatted text block optimized for clean WhatsApp messaging */
function buildWhatsAppSummary(
  profile: Profile,
  conditions: string[],
  meds: ReturnType<typeof currentMedicines>,
  out: ReturnType<typeof latestTests>,
  questions: string[],
  dateStr: string
): string {
  const lines: string[] = [
    `📋 *Health Copilot — Doctor Visit Summary*`,
    `👤 *Patient:* ${profile.name}${profile.age ? ` (${profile.age}y)` : ""}${profile.sex ? `, ${profile.sex}` : ""}`,
    profile.abha_number ? `🆔 *ABHA ID:* ${profile.abha_number}` : "",
    `📅 *Date:* ${dateStr}`,
    "",
  ];

  if (conditions.length) {
    lines.push(`🩺 *Diagnoses / Conditions:*`);
    conditions.forEach((c) => lines.push(`• ${c}`));
    lines.push("");
  }

  if (meds.length) {
    lines.push(`💊 *Current Medications (${meds.length}):*`);
    meds.forEach(({ m }) => {
      const schedule = [m.frequency, m.timing, m.duration].filter(Boolean).join(" · ");
      lines.push(`• *${m.name}* ${m.dosage || ""}${schedule ? ` — ${schedule}` : ""}`);
    });
    lines.push("");
  }

  if (out.length) {
    lines.push(`⚠️ *Out of Range Tests (${out.length}):*`);
    out.forEach(({ o }) => {
      lines.push(`• *${o.test_name}:* ${o.observed_value} ${o.unit || ""} [${o.flag}] (Ref: ${o.reference_range || "N/A"})`);
    });
    lines.push("");
  }

  if (questions.length) {
    lines.push(`❓ *Questions for Doctor:*`);
    questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    lines.push("");
  }

  lines.push(`_Shared securely from Personal Health Copilot_`);
  return lines.filter((l) => l !== "").join("\n");
}

/** One printable page to take to the doctor: who, conditions, current medicines, out-of-range values, questions, voice readout & WhatsApp sharing. */
export function VisitSummary({ profile, records, onBack }: { profile: Profile; records: HealthRecord[]; onBack: () => void }) {
  const { t, lang } = useI18n();
  const pushToast = useToast();
  const speech = useSpeech();

  const own = records.filter((r) => r.name_check !== "mismatch");
  const conditions = Array.from(new Set(own.flatMap((r) => r.extracted.diagnoses.map((d) => d.replace(/\s*\[.*\]/, "")))));
  const meds = currentMedicines(own);
  const out = latestTests(own).filter(({ o }) => isOut(o.flag));
  const questions = Array.from(new Set(own.slice(0, 3).flatMap((r) => pickList(r.extracted.doctor_questions, lang)))).slice(0, 6);
  const today = new Date().toISOString().slice(0, 10);
  const formattedToday = formatDate(today, lang);

  // Stop audio on unmount
  // useSpeech returns a new object every render; depend on the stable stop() so narration
  // is only cut on unmount, not on every re-render.
  const stopSpeech = speech.stop;
  useEffect(() => () => stopSpeech(), [stopSpeech]);

  const handleBack = () => {
    speech.stop();
    onBack();
  };

  const handleListen = () => {
    if (speech.speaking) {
      speech.stop();
    } else {
      const text = buildSpeechText(profile, conditions, meds, out, questions, lang);
      speech.speak(text, lang);
    }
  };

  const handleWhatsAppShare = () => {
    const text = buildWhatsAppSummary(profile, conditions, meds, out, questions, formattedToday);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    pushToast(t.copiedToClipboard, "ok");
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="animate-fade-up">
      {/* Top Action Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button onClick={handleBack} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-fg-3 hover:bg-hover hover:text-fg">
          <ArrowLeft size={14} /> {t.tabs.overview}
        </button>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {speech.speaking ? (
            <Button variant="danger" size="sm" className="flex-1 sm:flex-none justify-center" icon={<Stop size={15} weight="bold" />} onClick={speech.stop}>
              {t.stopAudio}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="flex-1 sm:flex-none justify-center" icon={<SpeakerHigh size={15} weight="bold" className="text-accent" />} onClick={handleListen}>
              {t.listenSummary} ({lang.toUpperCase()})
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 sm:flex-none justify-center hover:border-ok hover:text-ok"
            icon={<WhatsappLogo size={15} weight="fill" className="text-ok" />}
            onClick={handleWhatsAppShare}
          >
            {t.shareWhatsApp}
          </Button>
          <Button variant="primary" size="sm" className="flex-1 sm:flex-none justify-center" icon={<Printer size={15} />} onClick={() => window.print()}>
            {t.printPage}
          </Button>
        </div>
      </div>

      {/* Live Speaking Feedback Bar */}
      {speech.speaking && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent-soft/40 px-4 py-2.5 text-sm text-fg shadow-sm print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex items-center gap-0.5" aria-hidden>
              <span className="inline-block h-3.5 w-1 animate-pulse rounded bg-accent" />
              <span className="inline-block h-5 w-1 animate-pulse rounded bg-accent delay-75" />
              <span className="inline-block h-2.5 w-1 animate-pulse rounded bg-accent delay-150" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">
                {lang === "te" ? "సారాంశం చదువుతోంది (Telugu)" : lang === "hi" ? "सारांश सुना रहे हैं (Hindi)" : "Reading summary aloud (English)"}
              </p>
              <p className="truncate text-xs text-fg-2">
                {speech.currentSentence ? `"${speech.currentSentence}"` : "Starting narration..."}
              </p>
            </div>
          </div>
          <button onClick={speech.stop} className="shrink-0 rounded px-2.5 py-1 text-xs font-medium text-high hover:bg-high-soft">
            {t.stopAudio}
          </button>
        </div>
      )}

      {/* Printable Clinical Sheet */}
      <article className="panel mx-auto max-w-[820px] p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none" id="visit-summary">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-sm text-fg-3">{t.visitSummary} · {t.visitIntro}</p>
            <h1 className="display mt-1 text-[34px] font-semibold leading-tight">{profile.name}</h1>
            <p className="mt-1 text-sm text-fg-2">{[relationLabel(profile.relation, lang), ageLabel(profile.age, lang), profile.sex].filter(Boolean).join(" · ")}{profile.abha_number ? ` · ABHA ${profile.abha_number}` : ""}</p>
          </div>

          <div className="flex items-center gap-4">
            {/* Emergency Clinical QR Code */}
            <div className="flex items-center gap-2.5 rounded-lg border border-line bg-subtle/40 p-2 text-left">
              <QrCodeImage value={[`NAME:${profile.name}`, profile.abha_number ? `ABHA:${profile.abha_number}` : "", conditions.length ? `CONDITIONS:${conditions.join(",")}` : "", "EMERGENCY:112"].filter(Boolean).join(";")} size={64} label={t.emergencyQr} className="h-16 w-16 rounded border border-line" />
              <div className="text-xs">
                <div className="flex items-center gap-1 font-semibold text-fg">
                  <QrCode size={13} className="text-accent" /> {t.emergencyQr}
                </div>
                <p className="mt-0.5 text-[11px] text-fg-3">Scan in emergency</p>
                <p className="mt-0.5 font-mono text-[10px] text-fg-2">{profile.abha_number || `ID: HC-${profile.id.slice(0, 8)}`}</p>
              </div>
            </div>

            <p className="text-right text-sm text-fg-3">{t.preparedOn}<br /><span className="font-medium text-fg">{formattedToday}</span></p>
          </div>
        </header>

        <Section title={t.conditions}>
          {conditions.length ? <p>{conditions.join(", ")}</p> : <p className="text-fg-3">{t.noneRecorded}</p>}
        </Section>

        <Section title={t.nowMeds}>
          {meds.length ? (
            <table className="w-full text-[14px]">
              <thead><tr className="text-left text-xs text-fg-3"><th className="py-1 font-medium">{t.medicine}</th><th className="py-1 font-medium">{t.dose}</th><th className="py-1 font-medium">{t.when}</th><th className="py-1 font-medium">{t.prescribedBy}</th></tr></thead>
              <tbody>{meds.map(({ m, r }, i) => (
                <tr key={i} className="border-t border-line align-top"><td className="py-1.5 pr-3 font-medium">{m.name}</td><td className="num py-1.5 pr-3">{m.dosage}</td><td className="py-1.5 pr-3">{[m.frequency, m.timing, m.duration].filter(Boolean).join(" · ")}</td><td className="py-1.5 text-fg-2">{r.extracted.doctor_name || tidyName(r.extracted.facility_name)}, {formatDate(r.record_date, lang)}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="text-fg-3">{t.noneRecorded}</p>}
        </Section>

        <Section title={t.outOfRangeTitle}>
          {out.length ? (
            <table className="w-full text-[14px]">
              <thead><tr className="text-left text-xs text-fg-3"><th className="py-1 font-medium">{t.test}</th><th className="py-1 font-medium">{t.result}</th><th className="py-1 font-medium">{t.range}</th><th className="py-1 font-medium">{t.date}</th></tr></thead>
              <tbody>{out.map(({ o, r }, i) => (
                <tr key={i} className="border-t border-line"><td className="py-1.5 pr-3 font-medium">{o.test_name}</td><td className="num py-1.5 pr-3 font-semibold text-high">{o.observed_value} {o.unit} ({t[o.flag]})</td><td className="num py-1.5 pr-3">{o.reference_range}</td><td className="num py-1.5">{formatDate(r.record_date, lang)}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="text-ok">{t.allClear}</p>}
        </Section>

        {questions.length > 0 && (
          <Section title={t.questions}>
            <ol className="list-decimal space-y-1 pl-5 text-[14px]">{questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
          </Section>
        )}

        <Section title={t.recentDocs}>
          <ul className="space-y-1 text-[14px]">{own.slice(0, 6).map((r) => (
            <li key={r.id} className="flex justify-between gap-4"><span>{t.types[r.document_type]} · {tidyName(r.extracted.facility_name) || r.extracted.doctor_name}</span><span className="num text-fg-3">{formatDate(r.record_date, lang)}</span></li>
          ))}</ul>
        </Section>

        <p className="mt-8 border-t border-line pt-3 text-xs text-fg-3">{t.disclaimer}</p>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-6"><h2 className="mb-2 text-[15px] font-semibold">{title}</h2>{children}</section>;
}
