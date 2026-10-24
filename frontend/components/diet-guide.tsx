"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  WarningCircle,
  Plant,
  Drop,
  BowlFood,
  CookingPot,
  Sparkle,
  Prohibit,
  ArrowsLeftRight,
  Clock,
  SunHorizon,
  Sun,
  Moon,
  Footprints,
  Brain,
  ForkKnife,
  Coffee,
  Heartbeat,
  Printer,
  WhatsappLogo,
  SpeakerHigh,
  Stop,
  Check,
} from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import type { HealthRecord, Profile } from "@/lib/types";
import {
  generateDietPlan,
  type PatientDietPlan,
  type FoodRecommendation,
  type FoodRestriction,
  type LifestyleHabit,
  type DietIconName,
  type MealTimeSlot,
} from "@/lib/diet-advisor";
import { Badge, Button, useToast } from "./ui";
import { useSpeech } from "./use-speech";

/* ─── Minimal Vector Icon Component ─── */
function Icon({
  name,
  className = "h-4 w-4",
}: {
  name: DietIconName | string;
  className?: string;
}) {
  switch (name) {
    case "plant":
      return <Plant weight="duotone" className={className} />;
    case "drop":
    case "water":
      return <Drop weight="duotone" className={className} />;
    case "bowl":
    case "grain":
      return <BowlFood weight="duotone" className={className} />;
    case "cooking":
      return <CookingPot weight="duotone" className={className} />;
    case "sparkle":
      return <Sparkle weight="duotone" className={className} />;
    case "salad":
      return <ForkKnife weight="duotone" className={className} />;
    case "coffee":
      return <Coffee weight="duotone" className={className} />;
    case "heart":
      return <Heartbeat weight="duotone" className={className} />;
    case "prohibit":
      return <Prohibit weight="bold" className={className} />;
    case "walk":
      return <Footprints weight="duotone" className={className} />;
    case "mind":
      return <Brain weight="duotone" className={className} />;
    default:
      return <Sparkle weight="duotone" className={className} />;
  }
}

function SlotIcon({ slot }: { slot: MealTimeSlot }) {
  switch (slot) {
    case "morning":
    case "breakfast":
      return <SunHorizon weight="duotone" className="h-4 w-4 text-fg-3" />;
    case "lunch":
      return <Sun weight="duotone" className="h-4 w-4 text-fg-3" />;
    case "snack":
      return <Coffee weight="duotone" className="h-4 w-4 text-fg-3" />;
    case "dinner":
    case "bedtime":
      return <Moon weight="duotone" className="h-4 w-4 text-fg-3" />;
    default:
      return <Clock weight="duotone" className="h-4 w-4 text-fg-3" />;
  }
}

const GI_LABEL: Record<"en" | "hi" | "te", Record<"very-low" | "low" | "medium", string>> = {
  en: { "very-low": "Very low sugar impact", low: "Low sugar impact", medium: "Medium sugar impact" },
  hi: { "very-low": "शुगर पर बहुत कम असर", low: "शुगर पर कम असर", medium: "शुगर पर मध्यम असर" },
  te: { "very-low": "చక్కెరపై చాలా తక్కువ ప్రభావం", low: "చక్కెరపై తక్కువ ప్రభావం", medium: "చక్కెరపై మధ్యస్థ ప్రభావం" },
};

export function DietGuide({
  records,
  profile,
}: {
  records: HealthRecord[];
  profile: Profile;
}) {
  const { lang, t } = useI18n();
  const pushToast = useToast();
  const speech = useSpeech();

  const [activeTab, setActiveTab] = useState<"eat" | "avoid" | "schedule" | "habits">("eat");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const plan: PatientDietPlan = useMemo(
    () => generateDietPlan(records, profile),
    [records, profile]
  );

  // useSpeech returns a new object every render; depend on the stable stop() so narration
  // is only cut on unmount, not on every re-render.
  const stopSpeech = speech.stop;
  useEffect(() => () => stopSpeech(), [stopSpeech]);

  // Speech Narrative for accessibility
  const handleListen = useCallback(() => {
    if (speech.speaking) {
      speech.stop();
      return;
    }

    const parts: string[] = [];
    if (lang === "te") {
      parts.push(`ఆహార సూచనలు: ${profile.name} గారి కోసం. లక్ష్యం: ${plan.focusTitle.te}.`);
      plan.eat.forEach((i) => parts.push(`${i.name.te}: ${i.reason.te}. మోతాదు: ${i.portion.te}.`));
      plan.avoid.forEach((i) => parts.push(`నివారించండి: ${i.name.te}. బదులుగా: ${i.swapFor.te}.`));
    } else if (lang === "hi") {
      parts.push(`डाइट निर्देश: ${profile.name} के लिए। योजना: ${plan.focusTitle.hi}।`);
      plan.eat.forEach((i) => parts.push(`${i.name.hi}: ${i.reason.hi}। मात्रा: ${i.portion.hi}।`));
      plan.avoid.forEach((i) => parts.push(`परहेज: ${i.name.hi}। विकल्प: ${i.swapFor.hi}।`));
    } else {
      parts.push(`Diet and nutrition recommendations for ${profile.name}. Focus: ${plan.focusTitle.en}.`);
      plan.eat.forEach((i) => parts.push(`${i.name.en}: ${i.reason.en}. Portion: ${i.portion.en}.`));
      plan.avoid.forEach((i) => parts.push(`Limit: ${i.name.en}. Instead use: ${i.swapFor.en}.`));
    }

    speech.speak(parts.join(" "), lang);
  }, [speech, lang, profile.name, plan]);

  const handleShareWhatsApp = useCallback(() => {
    const lines: string[] = [
      `🩺 *Health Copilot — Diet & Lifestyle Plan*`,
      `👤 *Patient:* ${profile.name}`,
      `🎯 *Focus:* ${plan.focusTitle[lang]}`,
      "",
      `✅ *FOODS TO FAVOR:*`,
    ];

    plan.eat.forEach((item) => {
      lines.push(`• *${item.name[lang]}* [${item.badge[lang]}]`);
      lines.push(`  ↳ ${item.portion[lang]} · ${item.howToTake[lang]}`);
    });

    lines.push("");
    lines.push(`🔄 *RESTRICTIONS & SWAPS:*`);
    plan.avoid.forEach((item) => {
      lines.push(`❌ Limit: *${item.name[lang]}*`);
      lines.push(`  ↳ ✅ Swap to: *${item.swapFor[lang]}*`);
    });

    lines.push("");
    lines.push(`🚶 *DAILY HABITS:*`);
    plan.habits.forEach((habit) => {
      lines.push(`• *${habit.title[lang]}* (${habit.badge[lang]})`);
      lines.push(`  ${habit.desc[lang]}`);
    });

    lines.push("");
    lines.push(`_${t.dietDisclaimer}_`);
    const fullText = lines.join("\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(fullText).catch(() => {});
    }

    pushToast(
      lang === "te"
        ? "డైట్ ప్లాన్ కాపీ చేయబడింది"
        : lang === "hi"
        ? "डाइट प्लान कॉपी किया गया"
        : "Diet plan copied to clipboard",
      "ok"
    );

    const url = `https://wa.me/?text=${encodeURIComponent(fullText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [profile.name, plan, lang, pushToast, t]);

  const filteredFoods = useMemo(() => {
    if (selectedCategory === "all") return plan.eat;
    return plan.eat.filter((f) => f.category === selectedCategory);
  }, [plan.eat, selectedCategory]);

  const scheduleSlots: MealTimeSlot[] = ["morning", "breakfast", "lunch", "snack", "dinner", "bedtime"];

  const slotLabels: Record<MealTimeSlot, { en: string; hi: string; te: string }> = {
    morning: { en: "Morning (Empty Stomach)", hi: "सुबह (खाली पेट)", te: "ఉదయం (ఖాళీ కడుపుతో)" },
    breakfast: { en: "Breakfast", hi: "नाश्ता", te: "అల్పాహారం" },
    lunch: { en: "Lunch", hi: "दोपहर का भोजन", te: "మధ్యాహ్న భోజనం" },
    snack: { en: "Evening", hi: "शाम", te: "సాయంత్రం" },
    dinner: { en: "Dinner", hi: "रात का खाना", te: "రాత్రి భోజనం" },
    bedtime: { en: "Bedtime", hi: "सोने से पूर्व", te: "పడుకునే ముందు" },
  };

  const tabLabels = {
    eat: { en: "Foods to Favor", hi: "सुझाए गए आहार", te: "సిఫార్సు చేసినవి" },
    avoid: { en: "Restrictions & Swaps", hi: "परहेज व विकल्प", te: "నియంత్రణలు & ప్రత్యామ్నాయాలు" },
    schedule: { en: "Daily Schedule", hi: "समय-सारणी", te: "రోజువారీ సమయాలు" },
    habits: { en: "Daily Habits", hi: "दैनिक आदतें", te: "దినచర్యలు" },
  };

  const categoryLabels: Record<string, { en: string; hi: string; te: string }> = {
    all: { en: "All", hi: "सभी", te: "అన్నీ" },
    superfood: { en: "Superfoods", hi: "सुपरफूड्स", te: "సూపర్‌ఫుడ్స్" },
    grain: { en: "Grains", hi: "अनाज", te: "ధాన్యాలు" },
    vegetable: { en: "Vegetables", hi: "सब्जियां", te: "కూరగాయలు" },
    drink: { en: "Drinks", hi: "पेय", te: "పానీయాలు" },
  };

  const title = lang === "te" ? "ఆహార & జీవనశైలి మార్గదర్శి" : lang === "hi" ? "आहार और जीवनशैली मार्गदर्शन" : "Diet & daily habits";

  // Nothing on file to base advice on: ask for a record instead of showing a generic plan.
  if (plan.eat.length === 0 && plan.avoid.length === 0) {
    return (
      <section aria-label={title}>
        <p className="eyebrow mb-4">{title}</p>
        <div className="panel px-5 py-6">
          <p className="text-[15px] font-medium text-fg">{t.dietNeedRecords}</p>
          <p className="mt-1 max-w-xl text-sm text-fg-3">{t.dietNeedRecordsBody}</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={title} className="animate-fade-up">
      {/* ─── Clean Header matching overview.tsx ─── */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="eyebrow">{title}</p>
            {plan.triggeredBy.map((item, i) => (
              <Badge key={i} tone="accent">
                {item[lang]}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-sm text-fg-3">
            {plan.focusTitle[lang]} · <span className="text-fg-2">{plan.focusSubtitle[lang]}</span>
          </p>
          <p className="mt-2 flex max-w-2xl items-start gap-1.5 text-[13px] leading-snug text-warn">
            <WarningCircle size={15} weight="fill" className="mt-px shrink-0" aria-hidden />
            <span>{t.dietDisclaimer}</span>
          </p>
        </div>

        {/* Minimal Action Controls */}
        <div className="flex items-center gap-2 print:hidden">
          {speech.speaking ? (
            <Button
              variant="danger"
              size="sm"
              icon={<Stop size={14} weight="bold" />}
              onClick={speech.stop}
            >
              {lang === "te" ? "ఆపండి" : lang === "hi" ? "रोकें" : "Stop"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={<SpeakerHigh size={14} weight="duotone" className="text-fg-2" />}
              onClick={handleListen}
            >
              {lang === "te" ? "వినండి" : lang === "hi" ? "सुनें" : "Listen"}
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            icon={<WhatsappLogo size={14} weight="fill" className="text-ok" />}
            onClick={handleShareWhatsApp}
          >
            WhatsApp
          </Button>

          <Button
            variant="ghost"
            size="sm"
            icon={<Printer size={14} weight="duotone" />}
            onClick={() => window.print()}
          >
            {lang === "te" ? "ప్రింట్" : lang === "hi" ? "प्रिंट" : "Print"}
          </Button>
        </div>
      </div>

      {/* ─── Speech playback active indicator ─── */}
      {speech.speaking && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-subtle/70 px-4 py-2.5 text-xs text-fg-2 print:hidden">
          <div className="flex items-center gap-2 truncate">
            <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse" />
            <span className="truncate">{speech.currentSentence || "Narrating..."}</span>
          </div>
          <button onClick={speech.stop} className="shrink-0 text-high hover:underline font-medium">
            {lang === "te" ? "ఆపండి" : lang === "hi" ? "रोकें" : "Stop"}
          </button>
        </div>
      )}

      {/* ─── Minimal Segmented Pill Navigation ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
        <div className="w-full sm:w-auto overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-1">
          <div className="inline-flex shrink-0 rounded-full border border-line bg-subtle/50 p-1 text-sm">
            <button
              type="button"
              onClick={() => setActiveTab("eat")}
              className={`rounded-full px-3.5 py-1 text-xs sm:text-sm font-medium transition-all ${
                activeTab === "eat"
                  ? "bg-surface text-fg shadow-card font-semibold"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              {tabLabels.eat[lang]} <span className="num ml-1 text-xs text-fg-3">{plan.eat.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("avoid")}
              className={`rounded-full px-3.5 py-1 text-xs sm:text-sm font-medium transition-all ${
                activeTab === "avoid"
                  ? "bg-surface text-fg shadow-card font-semibold"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              {tabLabels.avoid[lang]} <span className="num ml-1 text-xs text-fg-3">{plan.avoid.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("schedule")}
              className={`rounded-full px-3.5 py-1 text-xs sm:text-sm font-medium transition-all ${
                activeTab === "schedule"
                  ? "bg-surface text-fg shadow-card font-semibold"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              {tabLabels.schedule[lang]}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("habits")}
              className={`rounded-full px-3.5 py-1 text-xs sm:text-sm font-medium transition-all ${
                activeTab === "habits"
                  ? "bg-surface text-fg shadow-card font-semibold"
                  : "text-fg-3 hover:text-fg"
              }`}
            >
              {tabLabels.habits[lang]} <span className="num ml-1 text-xs text-fg-3">{plan.habits.length}</span>
            </button>
          </div>
        </div>

        {/* Sub-Category Chips (Tab 1 only) */}
        {activeTab === "eat" && (
          <div className="flex w-full sm:w-auto items-center gap-1.5 overflow-x-auto text-xs pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(["all", "superfood", "grain", "vegetable", "drink"] as const).map((cat) => {
              const count = cat === "all" ? plan.eat.length : plan.eat.filter((f) => f.category === cat).length;
              if (cat !== "all" && count === 0) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    selectedCategory === cat
                      ? "bg-fg text-surface font-medium"
                      : "text-fg-3 hover:bg-hover hover:text-fg"
                  }`}
                >
                  {categoryLabels[cat][lang]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── TAB 1: FOODS TO FAVOR ─── */}
      {activeTab === "eat" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredFoods.map((item) => (
            <div
              key={item.id}
              className="panel flex flex-col justify-between p-5 transition-all hover:border-line-strong"
            >
              <div>
                {/* Header: Icon + Title + Badge */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-fg">
                      <Icon name={item.iconName} className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-[15px] font-semibold text-fg leading-snug">
                        {item.name[lang]}
                      </h3>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-fg-3">
                        <span className="capitalize">{item.category}</span>
                        {item.glycemicImpact && (
                          <>
                            <span>·</span>
                            <span className="text-ok font-medium">{GI_LABEL[lang][item.glycemicImpact]}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <Badge tone="ok">{item.badge[lang]}</Badge>
                </div>

                {/* Grounded Clinical Target */}
                <p className="mt-3 text-xs text-fg-3">
                  <span className="font-medium text-fg-2">
                    {lang === "te" ? "లక్ష్యం: " : lang === "hi" ? "लक्ष्य: " : "Target: "}
                  </span>
                  {item.biomarker[lang]}
                </p>

                {/* Clinical Mechanism */}
                <p className="mt-2 text-sm leading-relaxed text-fg-2">
                  {item.reason[lang]}
                </p>
              </div>

              {/* Minimal Intake Footnote */}
              <div className="mt-4 border-t border-line pt-3 text-xs text-fg-3">
                <div className="flex items-center justify-between text-fg-2 font-medium">
                  <span className="flex items-center gap-1.5">
                    <SlotIcon slot={item.mealTime} />
                    {slotLabels[item.mealTime][lang]}
                  </span>
                  <span className="num font-normal text-fg-3">{item.portion[lang]}</span>
                </div>
                <p className="mt-1 text-fg-3 leading-relaxed">{item.howToTake[lang]}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── TAB 2: RESTRICTIONS & SMART SWAPS ─── */}
      {activeTab === "avoid" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {plan.avoid.map((item) => (
            <div
              key={item.id}
              className="panel flex flex-col justify-between p-5 transition-all hover:border-line-strong"
            >
              <div>
                {/* Avoid Row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-high-soft text-high">
                      <Prohibit size={18} weight="bold" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-high">
                          {lang === "te" ? "నివారించండి" : lang === "hi" ? "परहेज करें" : "Limit / Avoid"}
                        </span>
                        <span className="text-xs text-fg-3">· {item.avoidReasonBadge[lang]}</span>
                      </div>
                      <h3 className="mt-0.5 text-[15px] font-semibold text-fg">
                        {item.name[lang]}
                      </h3>
                    </div>
                  </div>
                </div>

                <p className="mt-2 text-xs text-fg-3 leading-relaxed">
                  <span className="font-medium text-high">
                    {lang === "te" ? "ప్రభావం: " : lang === "hi" ? "कारण: " : "Risk: "}
                  </span>
                  {item.risk[lang]}
                </p>

                {/* Minimal Swap Row */}
                <div className="mt-4 rounded-lg border border-line bg-subtle/40 p-3.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-ok uppercase tracking-wider">
                    <ArrowsLeftRight size={13} weight="bold" />
                    <span>
                      {lang === "te" ? "స్మార్ట్ ప్రత్యామ్నాయం" : lang === "hi" ? "स्वस्थ विकल्प" : "Smart Swap"}
                    </span>
                    <span className="ml-auto text-fg-3 font-normal normal-case">
                      {item.swapAdvantageBadge[lang]}
                    </span>
                  </div>
                  <h4 className="mt-1 text-sm font-semibold text-fg">
                    {item.swapFor[lang]}
                  </h4>
                  <p className="mt-1 text-xs text-fg-2 leading-relaxed">
                    {item.swapReason[lang]}
                  </p>
                </div>
              </div>

              <div className="mt-3 text-[11px] text-fg-3">
                {lang === "te" ? "ఆధారం: " : lang === "hi" ? "आधार: " : "Linked finding: "}
                <span className="text-fg-2">{item.biomarker[lang]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── TAB 3: DAILY SCHEDULE (TIMELINE) ─── */}
      {activeTab === "schedule" && (
        <div className="panel divide-y divide-line overflow-hidden">
          {scheduleSlots.map((slot) => {
            const items = plan.eat.filter((f) => f.mealTime === slot);
            const habits = plan.habits.filter(
              (h) =>
                (slot === "lunch" && h.timing.en.includes("Meals")) ||
                (slot === "dinner" && h.timing.en.includes("Meals")) ||
                (slot === "bedtime" && h.timing.en.includes("8 PM"))
            );

            if (items.length === 0 && habits.length === 0) return null;

            return (
              <div key={slot} className="flex flex-col p-5 sm:flex-row sm:items-start sm:gap-6">
                <div className="w-48 shrink-0 mb-2 sm:mb-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <SlotIcon slot={slot} />
                    {slotLabels[slot][lang]}
                  </p>
                </div>

                <div className="flex-1 space-y-3">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-fg">
                          {item.name[lang]} <span className="num text-xs text-fg-3 font-normal">· {item.portion[lang]}</span>
                        </p>
                        <p className="text-xs text-fg-3 mt-0.5">{item.howToTake[lang]}</p>
                      </div>
                      <Badge tone="neutral" className="shrink-0">{item.badge[lang]}</Badge>
                    </div>
                  ))}

                  {habits.map((habit) => (
                    <div key={habit.id} className="flex items-start justify-between gap-4 pt-1">
                      <div>
                        <p className="text-sm font-medium text-fg-2">
                          {habit.title[lang]}
                        </p>
                        <p className="text-xs text-fg-3 mt-0.5">{habit.desc[lang]}</p>
                      </div>
                      <Badge tone="accent" className="shrink-0">{habit.badge[lang]}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── TAB 4: DAILY HABITS ─── */}
      {activeTab === "habits" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {plan.habits.map((habit) => (
            <div
              key={habit.id}
              className="panel flex flex-col justify-between p-5 transition-all hover:border-line-strong"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-subtle text-fg">
                    <Icon name={habit.iconName} className="h-5 w-5" />
                  </span>
                  <Badge tone="neutral">{habit.badge[lang]}</Badge>
                </div>

                <h3 className="mt-3 text-[15px] font-semibold text-fg">
                  {habit.title[lang]}
                </h3>
                <p className="mt-1.5 text-xs text-fg-3 font-medium">
                  {habit.timing[lang]}
                </p>
                <p className="mt-2 text-sm text-fg-2 leading-relaxed">
                  {habit.desc[lang]}
                </p>
              </div>

              <div className="mt-4 border-t border-line pt-3 text-xs text-fg-3">
                <span className="font-medium text-fg-2">
                  {lang === "te" ? "ప్రయోజనం: " : lang === "hi" ? "लाभ: " : "Clinical insight: "}
                </span>
                {habit.evidence[lang]}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
