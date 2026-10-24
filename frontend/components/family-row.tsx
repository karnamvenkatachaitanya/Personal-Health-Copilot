"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Sparkle } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Profile } from "@/lib/types";
import { MemberForm } from "./sidebar";
import { Avatar, Skeleton, cx } from "./ui";

/** Who you are looking at, and everyone else one click away. Lives on the page, not in the app bar. */
export function FamilyRow({ profiles, activeId, onSelect, onProfilesChanged }: {
  profiles: Profile[] | null; activeId: string | null; onSelect: (id: string) => void; onProfilesChanged: (select?: string) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAdding(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAdding(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  return (
    <div className="relative mx-auto max-w-[1240px] px-4 pt-4 sm:px-6 sm:pt-6" ref={ref}>
      <nav aria-label={t.family} className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="eyebrow mr-1.5 shrink-0 text-fg-3">{t.family}</span>
        {!profiles ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-24 rounded-full" />) : profiles.map((p) => {
          const on = p.id === activeId;
          return (
            <button key={p.id} onClick={() => onSelect(p.id)} aria-current={on ? "page" : undefined}
              className={cx("flex h-11 shrink-0 items-center gap-2 rounded-full border pl-1 pr-3.5 text-sm transition-colors sm:h-9 sm:pl-0.5 sm:pr-3",
                on ? "border-fg bg-surface font-medium text-fg" : "border-line text-fg-2 hover:border-fg/40 hover:text-fg")}>
              <Avatar name={p.name} size={30} />{p.name.split(" ")[0]}
            </button>
          );
        })}
        <div className="shrink-0">
          <button onClick={() => setAdding((v) => !v)} aria-label={t.addMember} aria-expanded={adding}
            className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 text-sm text-fg-3 hover:border-fg hover:text-fg sm:h-9">
            <Plus size={13} weight="bold" /><span className="hidden sm:inline">{t.addMember}</span>
          </button>
        </div>
      </nav>
      {adding && (
        <div className="absolute inset-x-4 top-full z-50 mt-1 panel p-1 shadow-pop sm:inset-x-auto sm:left-6 sm:w-72">
          <MemberForm onDone={(p) => { setAdding(false); if (p) onProfilesChanged(p.id); }} />
          {profiles && !profiles.some((p) => p.is_sample) && (
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-2 hover:bg-hover"
              onClick={async () => { setAdding(false); await api.loadSample().catch(() => {}); onProfilesChanged(); }}><Sparkle size={14} />{t.loadSample}</button>
          )}
        </div>
      )}
    </div>
  );
}
