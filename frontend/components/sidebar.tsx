"use client";
import { useState } from "react";
import { Plus, SignOut, Sparkle, UsersThree } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { relationLabel, useI18n } from "@/lib/i18n";
import type { Profile } from "@/lib/types";
import { LangSwitch } from "./lang-switch";
import { Logo } from "./logo";
import { Avatar, Button, Skeleton, cx } from "./ui";
import { CustomSelect } from "./custom-select";

export function Sidebar({ email, profiles, activeId, onSelect, onProfilesChanged, onOpenManageFamily }: {
  email: string; profiles: Profile[] | null; activeId: string | null;
  onSelect: (id: string) => void; onProfilesChanged: (select?: string) => void;
  onOpenManageFamily?: () => void;
}) {
  const { t, lang } = useI18n();
  const [adding, setAdding] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 items-center gap-2 px-4 text-[14px] font-semibold"><Logo /> {t.appName}</div>
      <nav aria-label={t.family} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <p className="px-2 pb-1.5 pt-2 text-xs font-medium text-fg-3">{t.family}</p>
        {!profiles ? (
          <div className="space-y-2 px-2">{[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-2.5 py-1"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 flex-1" /></div>)}</div>
        ) : (
          <ul className="space-y-px">
            {profiles.map((p) => {
              const on = p.id === activeId;
              return (
                <li key={p.id}>
                  <button onClick={() => onSelect(p.id)} aria-current={on ? "page" : undefined}
                    className={cx("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors", on ? "bg-surface shadow-card ring-1 ring-line" : "hover:bg-hover")}>
                    <Avatar name={p.name} />
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate text-[14px]", on ? "font-medium text-fg" : "text-fg-2")}>{p.name}</span>
                      <span className="block truncate text-xs text-fg-3">{relationLabel(p.relation, lang)}{p.age ? ` · ${p.age}` : ""}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {adding ? <MemberForm onDone={(p) => { setAdding(false); if (p) onProfilesChanged(p.id); }} />
          : <button onClick={() => setAdding(true)} className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] text-fg-3 hover:bg-hover hover:text-fg">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-line-strong"><Plus size={13} /></span>{t.addMember}
            </button>}
        {onOpenManageFamily && (
          <button onClick={onOpenManageFamily} className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[14px] text-fg-3 hover:bg-hover hover:text-fg">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line"><UsersThree size={14} /></span>{t.manageFamily}
          </button>
        )}
        {profiles && profiles.length > 0 && !profiles.some((p) => p.is_sample) && (
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" loading={sampleBusy} icon={<Sparkle size={14} />}
            onClick={async () => { setSampleBusy(true); try { await api.loadSample(); } finally { setSampleBusy(false); onProfilesChanged(); } }}>{t.loadSample}</Button>
        )}
      </nav>
      <div className="space-y-3 border-t border-line p-3">
        <LangSwitch />
        <div className="flex items-center justify-between gap-2 px-1 text-xs text-fg-3">
          <span className="truncate" title={email}>{email}</span>
          <button onClick={() => supabase().auth.signOut()} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-hover hover:text-fg"><SignOut size={14} />{t.signOut}</button>
        </div>
      </div>
    </div>
  );
}

export function MemberForm({ profile, initialName = "", initialAge = "", initialSex = "", initialRelation = "", hideCancel = false, onDone }: { profile?: Profile | null; initialName?: string; initialAge?: string; initialSex?: string; initialRelation?: string; hideCancel?: boolean; onDone: (p: Profile | null) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(profile ? profile.name : initialName);
  const [relation, setRelation] = useState(profile ? profile.relation : initialRelation);
  const [age, setAge] = useState((profile?.age || initialAge || "").replace(/\D/g, "").slice(0, 3));
  const rawSex = profile?.sex || initialSex || "";
  const [sex, setSex] = useState(["M", "F", "O"].includes(rawSex.toUpperCase()) ? rawSex.toUpperCase() : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = "h-9 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:shadow-focus focus:outline-none";
  return (
    <form className="space-y-2 p-2.5" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try {
        const payload = {
          name: name.trim(),
          relation: relation.trim() || "Family member",
          age: age || undefined,
          sex: sex || undefined,
        };
        const result = profile ? await api.updateProfile(profile.id, payload) : await api.createProfile(payload);
        onDone(result);
      }
      catch (x) { setErr((x as Error).message); setBusy(false); }
    }}>
      <input required autoFocus placeholder={t.name} value={name} onChange={(e) => setName(e.target.value)} className={f} />
      <input placeholder={t.relation} value={relation} onChange={(e) => setRelation(e.target.value)} className={f} />
      <div className="grid grid-cols-2 gap-2">
        <input placeholder={t.age} inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} className={f} />
        <CustomSelect
          value={sex}
          onChange={setSex}
          placeholder={t.sex}
          ariaLabel={t.sex}
          options={[
            { value: "F", label: "Female (F)" },
            { value: "M", label: "Male (M)" },
            { value: "O", label: "Other (O)" },
          ]}
        />
      </div>
      {err && <p className="text-xs text-high">{err}</p>}
      <div className="flex justify-end gap-1.5">
        {!hideCancel && <Button type="button" variant="ghost" size="sm" onClick={() => onDone(null)}>{t.cancel}</Button>}
        <Button variant="primary" size="sm" loading={busy}>{t.save}</Button>
      </div>
    </form>
  );
}
