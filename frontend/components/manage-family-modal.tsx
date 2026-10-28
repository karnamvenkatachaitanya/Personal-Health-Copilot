"use client";
import { useEffect, useRef, useState } from "react";
import { Check, IdentificationCard, PencilSimple, Plus, Sparkle, Trash, User, UsersThree, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { ageLabel, relationLabel, useI18n } from "@/lib/i18n";
import type { Profile } from "@/lib/types";
import { MemberForm } from "./sidebar";
import { Avatar, Badge, Button, cx, useToast } from "./ui";

interface ManageFamilyModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: Profile[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onProfilesChanged: (selectId?: string) => void;
  initialEditProfileId?: string | null;
}

export function ManageFamilyModal({
  isOpen,
  onClose,
  profiles,
  activeId,
  onSelect,
  onProfilesChanged,
  initialEditProfileId = null,
}: ManageFamilyModalProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(initialEditProfileId);
  const [addingNew, setAddingNew] = useState(false);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialEditProfileId) {
      setEditingId(initialEditProfileId);
      setAddingNew(false);
    }
  }, [initialEditProfileId, isOpen]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (editingId) setEditingId(null);
        else if (addingNew) setAddingNew(false);
        else onClose();
      }
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [isOpen, editingId, addingNew, onClose]);

  if (!isOpen) return null;

  const handleDelete = async (profile: Profile) => {
    if (!window.confirm(t.confirmRemove(profile.name))) return;
    setBusyDeleteId(profile.id);
    try {
      await api.deleteProfile(profile.id);
      toast(t.removed(profile.name));
      const remaining = profiles.filter((p) => p.id !== profile.id);
      const nextActive = profile.id === activeId ? (remaining[0]?.id || undefined) : undefined;
      onProfilesChanged(nextActive);
      if (editingId === profile.id) setEditingId(null);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusyDeleteId(null);
    }
  };

  const handleEditDone = (updated: Profile | null) => {
    if (updated) {
      toast(t.memberUpdated(updated.name));
      onProfilesChanged(updated.id);
    }
    setEditingId(null);
  };

  const handleAddDone = (created: Profile | null) => {
    if (created) {
      toast(t.filed(created.name));
      onProfilesChanged(created.id);
    }
    setAddingNew(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-family-title"
        className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl border border-line bg-surface shadow-pop overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 shrink-0 bg-surface/90 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <UsersThree size={20} weight="duotone" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="manage-family-title" className="text-base sm:text-lg font-semibold text-fg">
                  {t.manageFamily}
                </h2>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-fg-2">
                  {profiles.length}
                </span>
              </div>
              <p className="text-xs text-fg-3">{t.allMembers}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 bg-surface-2/40 px-5 py-2.5 shrink-0">
          <Button
            size="sm"
            variant={addingNew ? "secondary" : "primary"}
            icon={<Plus size={14} weight="bold" />}
            onClick={() => {
              setAddingNew((v) => !v);
              setEditingId(null);
            }}
          >
            {t.addMember}
          </Button>

          {profiles && !profiles.some((p) => p.is_sample) && (
            <Button
              size="sm"
              variant="ghost"
              loading={sampleBusy}
              icon={<Sparkle size={14} />}
              onClick={async () => {
                setSampleBusy(true);
                try {
                  await api.loadSample();
                  onProfilesChanged();
                  toast("Sample family loaded");
                } catch (e) {
                  toast((e as Error).message, "error");
                } finally {
                  setSampleBusy(false);
                }
              }}
            >
              {t.loadSample}
            </Button>
          )}
        </div>

        {/* Body content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
          {/* Add member form block */}
          {addingNew && (
            <div className="rounded-xl border border-accent/40 bg-accent-soft/20 p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                  {t.addMember}
                </span>
                <button
                  type="button"
                  onClick={() => setAddingNew(false)}
                  className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg text-xs"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="rounded-lg bg-surface border border-line p-1">
                <MemberForm onDone={handleAddDone} />
              </div>
            </div>
          )}

          {/* Members list */}
          {profiles.length === 0 ? (
            <div className="text-center py-10 px-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-fg-3 mb-3">
                <User size={24} />
              </div>
              <p className="text-sm font-medium text-fg">{t.emptyFamily}</p>
              <p className="text-xs text-fg-3 mt-1 max-w-sm mx-auto">{t.emptyFamilyBody}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {profiles.map((p) => {
                const isCurrent = p.id === activeId;
                const isEditing = editingId === p.id;

                if (isEditing) {
                  return (
                    <div
                      key={p.id}
                      className="rounded-xl border-2 border-accent bg-surface p-4 shadow-md animate-in fade-in duration-150"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                          {t.editFamilyMember}: {p.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg text-xs"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <MemberForm profile={p} onDone={handleEditDone} />
                    </div>
                  );
                }

                return (
                  <div
                    key={p.id}
                    className={cx(
                      "flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 transition-all",
                      isCurrent
                        ? "border-fg/40 bg-surface shadow-sm ring-1 ring-fg/10"
                        : "border-line bg-surface/60 hover:border-line-strong hover:bg-surface"
                    )}
                  >
                    {/* Left: Avatar and Profile Details */}
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={p.name} size={42} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-[15px] text-fg truncate">{p.name}</span>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok">
                              <Check size={11} weight="bold" /> Active
                            </span>
                          )}
                          {p.is_sample && (
                            <Badge className="py-0 text-[10px]">{t.sample}</Badge>
                          )}
                          {p.abha_linked && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok-soft px-2 py-0.5 text-[10px] text-ok">
                              <IdentificationCard size={11} weight="fill" /> ABHA
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-fg-3 mt-0.5 truncate">
                          {relationLabel(p.relation, lang)}
                          {p.age ? ` · ${ageLabel(p.age, lang)}` : ""}
                          {p.sex ? ` · ${p.sex}` : ""}
                        </p>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      {!isCurrent && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-8 px-2.5 text-fg-2 hover:text-fg"
                          onClick={() => {
                            onSelect(p.id);
                            onClose();
                          }}
                        >
                          Select
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs h-8 px-2.5 gap-1"
                        icon={<PencilSimple size={13} />}
                        onClick={() => {
                          setEditingId(p.id);
                          setAddingNew(false);
                        }}
                      >
                        {t.modifyMember}
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busyDeleteId === p.id}
                        className="h-8 w-8 p-0 text-fg-3 hover:text-high hover:bg-high-soft"
                        icon={<Trash size={14} />}
                        onClick={() => handleDelete(p)}
                        title={t.removeMember}
                        aria-label={t.removeMember}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-line px-5 py-3 bg-surface-2/30">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
