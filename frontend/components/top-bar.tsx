"use client";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, SignOut } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { ThemeToggle } from "./theme-toggle";
import { cx } from "./ui";

const LANGS: { code: Lang; label: string }[] = [{ code: "en", label: "EN" }, { code: "hi", label: "हिं" }, { code: "te", label: "తె" }];

export function TopBar({
  email,
  onOpenMcpGovernance,
}: {
  email: string;
  onOpenMcpGovernance?: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);

  return (
    <header className="sticky top-3 z-40 px-2 sm:px-6">
      <div className="on-dark mx-auto flex h-13 sm:h-14 max-w-[1240px] items-center gap-1.5 rounded-full bg-[#141414]/95 pl-3.5 pr-1.5 text-white sm:gap-3 sm:pl-5 sm:pr-2 shadow-[0_16px_40px_-16px_rgba(0,0,0,.55)] ring-1 ring-white/10 backdrop-blur-xl">
        <span className="display text-[18px] sm:text-[20px] font-bold tracking-tight">copilot<span className="text-high">.</span></span>
        <div className="flex-1" />

        <div className="flex items-center rounded-full border border-line p-0.5" role="radiogroup" aria-label={t.language}>
          {LANGS.map((l) => (
            <button key={l.code} role="radio" aria-checked={lang === l.code} onClick={() => setLang(l.code)}
              className={cx("h-8 sm:h-9 min-w-8 sm:min-w-9 rounded-full px-1.5 sm:px-2.5 text-[13px] sm:text-[14px] font-medium leading-none transition-colors", lang === l.code ? "bg-accent text-accent-fg" : "text-fg-3 hover:text-fg")}>{l.label}</button>
          ))}
        </div>
        {onOpenMcpGovernance && (
          <button onClick={onOpenMcpGovernance} aria-label={t.aiAccess} title={t.aiAccess}
            className="hidden h-10 w-10 place-items-center rounded-full border border-line text-fg-2 transition-colors hover:bg-hover hover:text-fg sm:grid">
            <ShieldCheck size={17} weight="bold" aria-hidden />
          </button>
        )}
        <ThemeToggle />
        <div className="relative" ref={ref}>
          <button onClick={() => setMenu((v) => !v)} aria-label="Account" aria-haspopup="menu" aria-expanded={menu}
            className="grid h-10 w-10 place-items-center rounded-full bg-subtle text-[13px] font-semibold uppercase text-fg-2 hover:bg-hover">{email.slice(0, 1)}</button>
          {menu && (
            <div role="menu" className="absolute right-0 top-11 z-50 w-64 panel p-1.5 text-sm shadow-pop">
              <p className="truncate px-3 py-2 text-fg-3">{email}</p>
              {onOpenMcpGovernance && (
                <button
                  role="menuitem"
                  onClick={() => { setMenu(false); onOpenMcpGovernance(); }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-hover"
                >
                  <ShieldCheck size={16} aria-hidden />
                  {t.aiAccess}
                </button>
              )}
              <button role="menuitem" onClick={() => supabase().auth.signOut()} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-hover"><SignOut size={16} aria-hidden />{t.signOut}</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
