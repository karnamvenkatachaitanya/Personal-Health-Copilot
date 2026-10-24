"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  Brain,
  Check,
  FirstAid,
  Flask,
  Lightbulb,
  ListBullets,
  Microphone,
  Pill,
  Phone,
  ShieldCheck,
  SpeakerHigh,
  SpeakerSlash,
  Sparkle,
  Stop,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatDate, useI18n } from "@/lib/i18n";
import { currentMedicines } from "@/lib/clinical";
import type { CopilotAnswer, HealthRecord, Profile } from "@/lib/types";
import { useSpeech } from "./use-speech";
import { Avatar, Badge, Card, ErrorNote, Spinner, cx } from "./ui";
import { DoctorCard } from "./doctor-card";

type Turn = {
  id: string;
  q: string;
  a?: CopilotAnswer;
  error?: string;
  fromVoice?: boolean;
  time: string;
};

// Real-time Sound Wave Animation Component
function SoundWave({ active = true }: { active?: boolean }) {
  return (
    <div className="flex items-center gap-0.5 h-3.5">
      <span className={cx("w-0.5 rounded-full transition-all duration-300", active ? "h-2.5 animate-pulse bg-accent" : "h-1 bg-fg-3")} style={{ animationDelay: "0ms" }} />
      <span className={cx("w-0.5 rounded-full transition-all duration-300", active ? "h-3.5 animate-pulse bg-accent" : "h-1.5 bg-fg-3")} style={{ animationDelay: "150ms" }} />
      <span className={cx("w-0.5 rounded-full transition-all duration-300", active ? "h-2 animate-pulse bg-accent" : "h-1 bg-fg-3")} style={{ animationDelay: "300ms" }} />
      <span className={cx("w-0.5 rounded-full transition-all duration-300", active ? "h-3 animate-pulse bg-accent" : "h-1.5 bg-fg-3")} style={{ animationDelay: "450ms" }} />
    </div>
  );
}

const THINKING_STEPS = [
  "Reading verified medical records...",
  "Checking clinical dosages & safety guidelines...",
  "Formulating verified medical guidance...",
];

export function AskView({
  profile,
  records,
  onOpen,
  initialQuery,
  onClearInitialQuery,
}: {
  profile: Profile;
  records: HealthRecord[];
  onOpen: (id: string) => void;
  initialQuery?: string | null;
  onClearInitialQuery?: () => void;
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [micState, setMicState] = useState<"idle" | "listening" | "transcribing">("idle");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [micErr, setMicErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat?: number; lon?: number; city?: string }>({ city: "Hyderabad" });

  // References
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const executedInitialRef = useRef<string | null>(null);
  const speech = useSpeech();
  const byShort = useMemo(() => new Map(records.map((r) => [r.id.slice(0, 8), r])), [records]);

  // Derived patient context
  const activeMeds = useMemo(() => currentMedicines(records), [records]);
  const latestDoctor = useMemo(() => {
    return records.find((r) => r.extracted.doctor_name)?.extracted.doctor_name || null;
  }, [records]);

  // The person whose chat is on screen right now; replies for anyone else are dropped.
  const activeProfileRef = useRef<string>(profile.id);
  activeProfileRef.current = profile.id;

  // Reset turns if profile switches
  const prevProfileIdRef = useRef<string>(profile.id);
  useEffect(() => {
    if (prevProfileIdRef.current !== profile.id) {
      prevProfileIdRef.current = profile.id;
      setTurns([]);
      speech.stop();
    }
  }, [profile.id, speech]);

  // Smooth scroll within chat container
  useEffect(() => {
    // Scroll only the conversation pane, and only once there is a conversation: scrolling on
    // the empty state pulled the whole page down and hid the welcome heading under the tabs.
    const el = scrollContainerRef.current;
    if (!el || turns.length === 0) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, liveTranscript, busy]);

  // Cycle thinking step animation when busy
  useEffect(() => {
    if (!busy) {
      setThinkingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setThinkingStep((s) => (s + 1) % THINKING_STEPS.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [busy]);

  // Geolocation for recommendations
  useEffect(() => {
    if (typeof window !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => setUserLoc({ city: "Hyderabad" }),
        { timeout: 5000 }
      );
    }
  }, []);

  async function ask(text: string, fromVoice = false) {
    const query = text.trim();
    if (!query || busy) return;
    setQ("");
    setLiveTranscript("");
    setBusy(true);
    speech.stop();

    const turnId = Math.random().toString(36).substring(2, 9);
    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    setTurns((ts) => [...ts, { id: turnId, q: query, fromVoice, time: nowTime }]);

    try {
      const history = turns
        .filter((t) => t.a?.answer)
        .slice(-4)
        .flatMap((t) => [
          { role: "user" as const, content: t.q },
          { role: "assistant" as const, content: t.a!.answer },
        ]);
      const askedFor = profile.id;
      const a = await api.ask(query, lang, askedFor, userLoc, history);
      // The family member was switched while this was in flight: do not show or speak it in the new chat.
      if (activeProfileRef.current !== askedFor) {
        setBusy(false);
        return;
      }
      setTurns((ts) => {
        if (ts.length === 0) return [{ id: turnId, q: query, a, fromVoice, time: nowTime }];
        return ts.map((x) => (x.id === turnId ? { ...x, a } : x));
      });

      if (autoSpeak && fromVoice) {
        setTimeout(() => {
          speech.speak(a.answer, a.language);
        }, 150);
      }
    } catch (e) {
      if (activeProfileRef.current !== profile.id) {
        setBusy(false);
        return;
      }
      setTurns((ts) => {
        if (ts.length === 0) return [{ id: turnId, q: query, error: (e as Error).message, fromVoice, time: nowTime }];
        return ts.map((x) => (x.id === turnId ? { ...x, error: (e as Error).message } : x));
      });
    }
    setBusy(false);
  }

  // Handle external query navigation from Overview or Medicines
  useEffect(() => {
    if (!initialQuery) {
      executedInitialRef.current = null;
      return;
    }
    const qToRun = initialQuery.trim();
    if (!qToRun) return;

    if (executedInitialRef.current !== qToRun) {
      executedInitialRef.current = qToRun;
      onClearInitialQuery?.();
      ask(qToRun);
    }
  }, [initialQuery]);

  // Copy answer to clipboard
  function copyAnswer(id: string, text: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Clear conversation
  function clearChat() {
    speech.stop();
    setTurns([]);
    setMicState("idle");
    setLiveTranscript("");
  }

  // Microphone toggle
  async function toggleMic() {
    setMicErr(null);

    if (micState === "listening") {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      if (mr.current && mr.current.state === "recording") {
        try { mr.current.stop(); } catch {}
      }
      setMicState("idle");
      return;
    }

    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = lang === "hi" ? "hi-IN" : lang === "te" ? "te-IN" : "en-IN";

        recognition.onstart = () => {
          setMicState("listening");
          setLiveTranscript("");
        };

        recognition.onresult = (event: any) => {
          let currentInterim = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              currentInterim += event.results[i][0].transcript;
            }
          }

          const combined = (finalTranscript || currentInterim).trim();
          if (combined) {
            setQ(combined);
            setLiveTranscript(combined);
          }
        };

        recognition.onerror = () => {
          startMediaRecorderFallback();
        };

        recognition.onend = () => {
          setMicState("idle");
          if (liveTranscript.trim()) {
            ask(liveTranscript.trim(), true);
          } else if (lang === "te") {
            startMediaRecorderFallback();
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
        return;
      } catch {
        startMediaRecorderFallback();
      }
    }

    startMediaRecorderFallback();
  }

  // MediaRecorder Fallback with Groq Whisper
  async function startMediaRecorderFallback() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const m = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];

      m.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.current.push(e.data);
      };

      m.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setMicState("transcribing");
        try {
          const blobType = mimeType || "audio/webm";
          const blob = new Blob(chunks.current, { type: blobType });
          if (blob.size > 200) {
            const { text } = await api.transcribe(blob, lang);
            if (text && text.trim()) {
              setQ(text.trim());
              ask(text.trim(), true);
            }
          }
        } catch (e) {
          setMicErr((e as Error).message || "Could not transcribe audio.");
        }
        setMicState("idle");
      };

      mr.current = m;
      m.start(250);
      setMicState("listening");
    } catch {
      // Tell the person what will work instead of a generic failure.
      const unsupported = typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia;
      setMicErr(unsupported ? t.micUnsupported : !window.isSecureContext ? t.micNeedsHttps : t.micDenied);
      setMicState("idle");
    }
  }

  return (
    <div className="flex h-[calc(100dvh-175px)] sm:h-[calc(100dvh-190px)] min-h-[460px] max-h-[820px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {/* Top Professional Header Bar */}
      <div className="flex h-11 sm:h-12 shrink-0 items-center justify-between border-b border-line bg-surface/90 px-3.5 backdrop-blur-md sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-subtle text-fg-2">
            <Sparkle size={15} weight="fill" aria-hidden />
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm font-bold text-fg">Health Copilot</span>
            <Badge className="hidden py-0 text-[11px] sm:inline-flex">
              {t.askCites}
            </Badge>
          </div>
        </div>

        {/* Center Grounded Pill (Responsive) */}
        <div className="hidden md:flex items-center gap-1.5 rounded-full border border-line/80 bg-canvas/60 px-3 py-1 text-[11px] text-fg-3">
          <ShieldCheck size={13} className="text-ok" weight="fill" />
          <span>Grounded in {records.length} records for <strong className="text-fg font-semibold">{profile.name}</strong></span>
          {activeMeds.length > 0 && <span className="text-fg-3">· {activeMeds.length} active meds</span>}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5">
          {speech.speaking && (
            <div className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent animate-pulse">
              <SoundWave active={true} />
              <span className="hidden sm:inline">Speaking</span>
              <button onClick={() => speech.stop()} className="ml-1 text-fg hover:underline font-bold">
                Stop
              </button>
            </div>
          )}

          <button
            onClick={() => {
              if (speech.speaking) speech.stop();
              setAutoSpeak(!autoSpeak);
            }}
            title={autoSpeak ? "Voice answers on. Click to mute." : "Voice answers muted. Click to turn on."}
            aria-label={autoSpeak ? t.voiceOn : t.voiceOff}
            aria-pressed={autoSpeak}
            className={cx(
              "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
              autoSpeak
                ? "border-accent/40 bg-accent-soft text-accent font-semibold"
                : "border-line bg-surface text-fg-3 hover:text-fg"
            )}
          >
            {autoSpeak ? <SpeakerHigh size={13} weight="bold" /> : <SpeakerSlash size={13} />}
            <span className="hidden sm:inline">{autoSpeak ? t.voiceOn : t.voiceOff}</span>
          </button>

          {turns.length > 0 && (
            <button
              onClick={clearChat}
              title="Clear conversation"
              aria-label={t.clearChat}
              className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-fg-3 transition-colors hover:border-warn hover:text-warn"
            >
              <Trash size={13} />
              <span className="hidden sm:inline">{t.clearChat}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Conversation Stream */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4"
      >
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {turns.length === 0 && (
            <div className="space-y-5 py-2 text-center sm:py-6">
              {/* Welcoming Header */}
              <div className="space-y-1.5">
                <h3 className="display text-[20px] font-semibold leading-tight text-fg sm:text-[24px]">
                  {t.askWelcome(profile.name)}
                </h3>
                <p className="mx-auto max-w-md text-sm leading-relaxed text-fg-3">
                  {t.askWelcomeBody(profile.name)}
                </p>
              </div>

              {/* Starter questions: one neutral style, the icon tells them apart */}
              <div className="grid gap-2.5 text-left sm:grid-cols-2">
                {t.askStarters.map(([title, body, query], i) => {
                  const Icon = [Pill, WarningCircle, Flask, ListBullets][i] || Sparkle;
                  return (
                    <button
                      key={title}
                      onClick={() => ask(query)}
                      className="group flex min-h-[64px] items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-left transition-colors hover:border-fg/30 hover:bg-hover/50"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-subtle text-fg-2">
                        <Icon size={18} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-fg">{title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-fg-3">{body}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Quick Prompt Pills */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                {t.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="min-h-10 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] text-fg-2 transition-colors hover:border-fg/30 hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation Bubbles */}
          {turns.map((turn) => (
            <div key={turn.id} className="space-y-3">
              {/* User Bubble */}
              <div className="flex justify-end">
                <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%]">
                  <div className="flex items-center gap-1.5">
                    {turn.fromVoice && (
                      <span title="Voice" className="text-accent text-[10px] font-semibold flex items-center gap-0.5 bg-accent-soft rounded px-1.5 py-0.5">
                        <Microphone size={11} /> Voice
                      </span>
                    )}
                    <p className="rounded-2xl rounded-tr-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-accent-fg">
                      {turn.q}
                    </p>
                  </div>
                  <span className="mt-0.5 text-[10px] text-fg-3 num pr-1">{turn.time}</span>
                </div>
              </div>

              {/* Assistant Message */}
              <div className="flex gap-3 items-start">
                <span className="mt-1 hidden h-7 w-7 shrink-0 place-items-center rounded-full bg-subtle text-fg-2 sm:grid">
                  <Sparkle size={14} weight="fill" />
                </span>

                <div className="min-w-0 flex-1">
                  {/* Thinking State */}
                  {!turn.a && !turn.error && (
                    <div className="rounded-2xl border border-accent/25 bg-surface p-3.5 shadow-xs space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-accent">
                        <Spinner className="h-3.5 w-3.5" />
                        <span className="text-xs font-semibold">{t.thinkingSteps[thinkingStep % t.thinkingSteps.length]}</span>
                      </div>
                      <div className="h-0.5 w-full bg-accent-soft rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full animate-pulse w-2/3" />
                      </div>
                    </div>
                  )}

                  {/* Error State */}
                  {turn.error && (
                    <ErrorNote
                      message={turn.error}
                      onRetry={() => ask(turn.q, turn.fromVoice)}
                      retryLabel={t.tryAgain}
                    />
                  )}

                  {/* Answer Body */}
                  {turn.a && (
                    <div
                      className={cx(
                        "rounded-2xl border p-4 sm:p-5 shadow-xs transition-all",
                        turn.a.safety === "crisis"
                          ? "border-high/40 bg-high-soft"
                          : "border-line bg-surface/95"
                      )}
                    >
                      {/* Emergency Hotline */}
                      {turn.a.safety === "crisis" && (
                        <a
                          href="tel:112"
                          className="mb-3 inline-flex items-center gap-2 rounded-xl bg-high px-3.5 py-1.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:opacity-90"
                        >
                          <Phone size={15} weight="fill" />
                          <span>Emergency Hotline: Call 112 Immediately</span>
                        </a>
                      )}

                      {/* Rendered Markdown */}
                      <div className="max-w-[72ch] space-y-2.5 text-[15px] leading-relaxed text-fg">
                        {renderAnswer(turn.a.answer, byShort, onOpen)}
                      </div>

                      {/* Follow-up Question Chips */}
                      {turn.a.suggested_questions && turn.a.suggested_questions.length > 0 && (
                        <div className="mt-3.5 pt-3 border-t border-line/70">
                          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-fg-3">
                            <Lightbulb size={12} weight="fill" className="text-warn" />
                            <span>Suggested Next</span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {turn.a.suggested_questions.map((sq, sqIdx) => (
                              <button
                                key={sqIdx}
                                disabled={busy}
                                onClick={() => ask(sq)}
                                className="group inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent-soft/30 px-3 py-1 text-xs font-medium text-fg hover:border-accent hover:bg-accent-soft hover:text-accent transition-all text-left shadow-xs disabled:opacity-50"
                              >
                                <span>{sq}</span>
                                <ArrowRight size={10} className="text-accent/80 group-hover:translate-x-0.5 transition-transform" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action Bar */}
                      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-fg-3">
                        {/* Citations */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {turn.a.citations.map((c) => {
                            const rec = byShort.get(c.record_id.slice(0, 8));
                            return (
                              <button
                                key={c.record_id}
                                onClick={() => onOpen(c.record_id)}
                                title={c.title || "View document"}
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-subtle/80 px-2 py-0.5 text-fg-2 hover:border-accent/40 hover:text-accent font-mono text-[11px] transition-colors"
                              >
                                <span>{rec ? t.types[rec.document_type] : c.title.split(",")[0] || "Record"}</span>
                                <span className="text-fg-3">· {formatDate(c.record_date, lang)}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Quick action buttons */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => copyAnswer(turn.id, turn.a!.answer)}
                            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-fg-3 hover:text-fg hover:bg-hover transition-colors"
                            title="Copy answer"
                          >
                            {copiedId === turn.id ? (
                              <>
                                <Check size={12} className="text-ok" />
                                <span className="font-semibold text-ok">Copied</span>
                              </>
                            ) : (
                              <span>Copy</span>
                            )}
                          </button>

                          <button
                            onClick={() => ask("Could you explain that in simpler words?")}
                            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-fg-3 hover:text-fg hover:bg-hover transition-colors"
                            title="Explain simpler"
                          >
                            <span>Simpler</span>
                          </button>

                          {speech.supported && (
                            <button
                              className={cx(
                                "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                                speech.speaking
                                  ? "border-accent bg-accent-soft text-accent"
                                  : "border-line text-fg-3 hover:text-fg hover:bg-hover"
                              )}
                              onClick={() => {
                                if (speech.speaking) {
                                speech.stop();
                              } else {
                                speech.speak(turn.a!.answer, turn.a!.language);
                              }
                            }}
                            >
                              {speech.speaking ? (
                                <>
                                  <SoundWave active={true} />
                                  <span>Stop</span>
                                </>
                              ) : (
                                <>
                                  <SpeakerHigh size={13} />
                                  <span>Read</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Doctor Recommendations */}
                      {turn.a.doctors && turn.a.doctors.length > 0 && (
                        <div className="mt-3.5 border-t border-line/70 pt-3">
                          <p className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-accent">
                            <FirstAid size={13} weight="bold" />
                            <span>{t.recommendedDoctors}</span>
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {turn.a.doctors.map((doc, idx) => (
                              <DoctorCard
                                key={idx}
                                doc={doc}
                                lang={lang}
                                callLabel={t.callHospital}
                                directionsLabel={t.getDirections}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          <div ref={endRef} />
        </div>
      </div>

      {/* Voice Recording Banner */}
      {micState === "listening" && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-xl border border-accent/40 bg-accent-soft/90 px-3.5 py-2 text-xs text-accent shadow-xs animate-fade-up">
          <div className="flex items-center gap-2">
            <SoundWave active={true} />
            <span className="font-semibold text-xs">
              {liveTranscript ? `"${liveTranscript}"` : "Listening live... Speak now"}
            </span>
          </div>
          <button
            onClick={toggleMic}
            className="rounded-lg bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-fg hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      )}

      {/* Professional Floating Input Bar */}
      <div className="border-t border-line bg-surface/95 px-3 py-2.5 sm:px-4 sm:py-3 backdrop-blur-md">
        {micErr && <p className="mb-1 text-center text-xs text-high font-medium">{micErr}</p>}
        <div className="mx-auto max-w-3xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
            className="flex items-end gap-1.5 rounded-[26px] border border-line bg-canvas/80 p-1.5 pl-3 transition-colors focus-within:border-fg/40 sm:gap-2"
          >
            <span className="hidden self-center sm:inline-flex"><Avatar name={profile.name} size={30} /></span>
            <textarea
              ref={textareaRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(q);
                }
              }}
              placeholder={
                micState === "listening"
                  ? "Listening live... speak now"
                  : micState === "transcribing"
                  ? "Transcribing with Whisper..."
                  : `Ask about ${profile.name}'s records (EN, HI, TE)...`
              }
              aria-label={t.askButton}
              className="max-h-36 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-[16px] leading-snug text-fg placeholder:text-fg-3 focus:outline-none sm:text-[15px]"
            />

            {q.trim() && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="grid h-11 w-9 shrink-0 place-items-center text-fg-3 transition-colors hover:text-fg"
                title="Clear text"
                aria-label="Clear text"
              >
                <X size={15} />
              </button>
            )}

            <button
              type="button"
              onClick={toggleMic}
              disabled={micState === "transcribing"}
              aria-label={micState === "listening" ? t.stop : t.speak}
              title={micState === "listening" ? "Stop listening" : "Voice question"}
              className={cx(
                "grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors",
                micState === "listening"
                  ? "animate-pulse border-high bg-high text-white"
                  : "border-line bg-surface text-fg-2 hover:border-fg/30 hover:text-fg"
              )}
            >
              {micState === "transcribing" ? (
                <Spinner />
              ) : micState === "listening" ? (
                <Stop size={14} weight="fill" />
              ) : (
                <Microphone size={19} weight="bold" />
              )}
            </button>

            <button
              disabled={busy || !q.trim()}
              aria-label={t.askButton}
              title="Press Enter to send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              {busy ? <Spinner /> : <ArrowUp size={16} weight="bold" />}
            </button>
          </form>

          {/* Under-input Disclaimer matching professional chatbots */}
          <p className="mt-1.5 text-center text-[11px] leading-tight text-fg-3">
            Health Copilot can make mistakes. Verify important medical decisions with your doctor.
          </p>
        </div>
      </div>
    </div>
  );
}

function renderAnswer(
  text: string,
  byShort: Map<string, HealthRecord>,
  onOpen: (id: string) => void
) {
  const inline = (s: string, key: string) =>
    s.split(/(\*\*[^*]+\*\*|\[[a-zA-Z0-9_-]{8}\]|【[a-zA-Z0-9_-]{8}】)/g).map((part, i) => {
      if (/^\*\*.+\*\*$/.test(part))
        return (
          <strong key={`${key}-${i}`} className="font-semibold text-fg">
            {part.slice(2, -2)}
          </strong>
        );
      const m = part.match(/^[\[【]([a-zA-Z0-9_-]{8})[\]】]$/);
      if (m) {
        const r = byShort.get(m[1]);
        return r ? (
          <button
            key={`${key}-${i}`}
            onClick={() => onOpen(r.id)}
            title={r.title}
            className="mx-0.5 inline-flex h-4 items-center rounded bg-accent-soft px-1.5 align-[1px] text-[10px] font-medium text-accent hover:bg-accent hover:text-accent-fg transition-colors font-mono"
          >
            {r.record_date ? r.record_date.slice(5) : "record"}
          </button>
        ) : (
          <span
            key={`${key}-${i}`}
            title="Referenced record"
            className="mx-0.5 inline-flex h-4 items-center rounded border border-line bg-subtle px-1 align-[1px] text-[10px] font-medium text-fg-3 font-mono"
          >
            ref
          </span>
        );
      }
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    });

  const renderCellContent = (content: string, key: string) => {
    const trimmed = content.trim();
    const upper = trimmed.toUpperCase();
    if (upper === "HIGH" || upper === "ABNORMAL" || upper === "ఎక్కువు" || upper === "అధిక" || upper === "अधिक") {
      return (
        <span className="inline-flex items-center rounded-full bg-high-soft px-2 py-0.5 text-[10px] font-bold text-high ring-1 ring-inset ring-high/20">
          {trimmed}
        </span>
      );
    }
    if (upper === "LOW" || upper === "తక్కువ" || upper === "कम") {
      return (
        <span className="inline-flex items-center rounded-full bg-low-soft px-2 py-0.5 text-[10px] font-bold text-low ring-1 ring-inset ring-low/20">
          {trimmed}
        </span>
      );
    }
    if (upper === "NORMAL" || upper === "సాధారణం" || upper === "సాధారణ" || upper === "सामान्य") {
      return (
        <span className="inline-flex items-center rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-bold text-ok ring-1 ring-inset ring-ok/20">
          {trimmed}
        </span>
      );
    }
    return inline(trimmed, key);
  };

  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const l = raw.trim();

    if (!l) {
      i++;
      continue;
    }

    // Markdown Table
    if (l.startsWith("|") && l.endsWith("|") && i + 1 < lines.length && /^\|[-:\s|]+\|$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (rowStr: string) =>
          rowStr
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim());

        const headers = parseRow(tableLines[0]);
        const dataRows = tableLines.slice(2).map(parseRow);

        blocks.push(
          <div key={`tbl-${blocks.length}`} className="my-2.5 overflow-x-auto rounded-xl border border-line bg-surface shadow-xs">
            <table className="min-w-full divide-y divide-line text-xs sm:text-[13px]">
              <thead className="bg-subtle/70 font-semibold text-fg">
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi} className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-fg-2 font-bold">
                      {inline(h, `th-${hi}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {dataRows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-hover/40 transition-colors">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-fg leading-snug">
                        {renderCellContent(cell, `td-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Checklist item `- [ ]` or `- [x]`
    if (/^[-*•]\s+\[([ xX])\]\s+/.test(l)) {
      const checkItems: { checked: boolean; text: string }[] = [];
      while (i < lines.length && /^[-*•]\s+\[([ xX])\]\s+/.test(lines[i].trim())) {
        const m = lines[i].trim().match(/^[-*•]\s+\[([ xX])\]\s+(.*)$/);
        if (m) {
          checkItems.push({ checked: m[1].toLowerCase() === "x", text: m[2] });
        }
        i++;
      }
      blocks.push(
        <div key={`chk-grp-${blocks.length}`} className="my-2 space-y-1.5 rounded-xl border border-accent/25 bg-accent-soft/20 p-3 shadow-xs">
          {checkItems.map((item, ci) => (
            <div key={ci} className="flex items-start gap-2.5">
              <span
                className={cx(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition-colors",
                  item.checked ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-transparent"
                )}
              >
                ✓
              </span>
              <span className="flex-1 text-xs sm:text-[13.5px] leading-relaxed text-fg">
                {inline(item.text, `chk-${ci}`)}
              </span>
            </div>
          ))}
        </div>
      );
      continue;
    }

    // Blockquote or warning
    if (l.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ""));
        i++;
      }
      const quoteText = quoteLines.join(" ");
      blocks.push(
        <blockquote
          key={`bq-${blocks.length}`}
          className="my-2.5 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm leading-relaxed text-fg"
        >
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-warn" />
          <div className="flex-1">{inline(quoteText, `bq-${blocks.length}`)}</div>
        </blockquote>
      );
      continue;
    }

    // Headings
    const headingMatch = l.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      blocks.push(
        <h4 key={`h-${blocks.length}`} className="mt-3.5 mb-1 text-xs sm:text-sm font-bold tracking-tight text-fg">
          {inline(headingMatch[2], `h-${blocks.length}`)}
        </h4>
      );
      i++;
      continue;
    }

    // Unordered List
    if (/^[-*•]\s+/.test(l)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim()) && !/^[-*•]\s+\[([ xX])\]/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1.5 pl-4 marker:text-accent text-xs sm:text-[13.5px]">
          {listItems.map((item, li) => (
            <li key={li} className="leading-relaxed">
              {inline(item, `ul-${li}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered List
    if (/^\d+\.\s+/.test(l)) {
      const numItems: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        numItems.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="my-2 list-decimal space-y-1.5 pl-4 marker:font-semibold marker:text-accent text-xs sm:text-[13.5px]">
          {numItems.map((item, li) => (
            <li key={li} className="leading-relaxed">
              {inline(item, `ol-${li}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal Rule
    if (/^-{3,}$/.test(l)) {
      blocks.push(<hr key={`hr-${blocks.length}`} className="my-3 border-line" />);
      i++;
      continue;
    }

    // Regular Paragraph
    blocks.push(
      <p key={`p-${blocks.length}`} className="leading-relaxed text-xs sm:text-[14px]">
        {inline(l, `p-${blocks.length}`)}
      </p>
    );
    i++;
  }

  return blocks;
}
