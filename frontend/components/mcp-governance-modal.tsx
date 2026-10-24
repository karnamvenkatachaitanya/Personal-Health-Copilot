"use client";
import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle,
  Copy,
  Key,
  Lock,
  ShieldCheck,
  Sparkle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cx, useToast } from "./ui";

interface McpGovernanceModalProps {
  email: string;
  profiles: Profile[];
  onClose: () => void;
}

const TOOL_DESCRIPTIONS: Record<string, { label: string; desc: string; category: string }> = {
  list_patient_profiles: {
    label: "List Family Profiles",
    desc: "Allows MCP to view patient names, relations, and ages.",
    category: "Identity",
  },
  get_patient_summary: {
    label: "Patient Medical Summary",
    desc: "Allows MCP to read diagnoses, medication counts, and visit summaries.",
    category: "Clinical",
  },
  get_prescribed_medications: {
    label: "Active Prescriptions & Dosages",
    desc: "Exposes exact medication names, dosages, timings, and schedules.",
    category: "Medications",
  },
  get_lab_reports: {
    label: "Lab Observations & Abnormal Flags",
    desc: "Allows MCP to read blood tests, biomarker values, and HIGH/LOW flags.",
    category: "Diagnostics",
  },
  check_drug_safety: {
    label: "Drug-Drug Safety & Precautions",
    desc: "Permits medication conflict screening and food/alcohol warning checks.",
    category: "Safety",
  },
  ask_health_copilot: {
    label: "AI Clinical Reasoning on Records",
    desc: "Enables answering medical questions grounded in family documents.",
    category: "AI Reasoning",
  },
  find_specialist_doctors: {
    label: "Doctor & Hospital Recommendations",
    desc: "Allows finding verified local specialists and clinics by diagnosis.",
    category: "Navigation",
  },
};

export function McpGovernanceModal({ email, profiles, onClose }: McpGovernanceModalProps) {
  const toast = useToast();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policyData, setPolicyData] = useState<any>(null);
  const [rawGeneratedKey, setRawGeneratedKey] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [activeTab, setActiveTab] = useState<"keys" | "tools" | "privacy" | "audit">("keys");

  // Load policy and audit logs
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [pol, logs] = await Promise.all([
          api.mcpPolicy().catch(() => null),
          api.mcpAuditLogs(25).catch(() => []),
        ]);
        if (pol) {
          setPolicyData(pol);
        }
        setAuditLogs(logs || []);
      } catch (e) {
        toast("Failed to load MCP governance settings.", "error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleToggleMaster(isActive: boolean) {
    if (!policyData) return;
    try {
      setSaving(true);
      const res = await api.updateMcpPolicy({ is_active: isActive });
      setPolicyData((prev: any) => ({
        ...prev,
        policy: { ...prev.policy, is_active: res.policy.is_active },
      }));
      toast(isActive ? "MCP Access Enabled." : "MCP Access Disabled (Kill-switch active).", "ok");
    } catch {
      toast("Failed to update MCP master status.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleTool(toolName: string) {
    if (!policyData) return;
    const currentTools: string[] = policyData.policy.enabled_tools || [];
    const newTools = currentTools.includes(toolName)
      ? currentTools.filter((t) => t !== toolName)
      : [...currentTools, toolName];

    try {
      setSaving(true);
      const res = await api.updateMcpPolicy({ enabled_tools: newTools });
      setPolicyData((prev: any) => ({
        ...prev,
        policy: { ...prev.policy, enabled_tools: res.policy.enabled_tools },
      }));
      toast(`Updated permissions for ${TOOL_DESCRIPTIONS[toolName]?.label || toolName}`, "ok");
    } catch {
      toast("Failed to update tool permissions.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePatientPrivacy(patientId: string) {
    if (!policyData) return;
    const currentAllowed: string[] = policyData.policy.allowed_patient_ids || [];
    let newAllowed: string[];

    const unticking = currentAllowed.length === 0 || currentAllowed.includes(patientId);
    // If currently empty, user was allowing all. Explicitly exclude this one.
    if (currentAllowed.length === 0) {
      newAllowed = profiles.filter((p) => p.id !== patientId).map((p) => p.id);
    } else if (currentAllowed.includes(patientId)) {
      newAllowed = currentAllowed.filter((id) => id !== patientId);
    } else {
      newAllowed = [...currentAllowed, patientId];
      // If all profiles are now allowed, can reset to []
      if (newAllowed.length >= profiles.length) {
        newAllowed = [];
      }
    }

    // An empty list means "everyone" to the server, so unticking the last person would expose
    // the whole family. Keep at least one; the master switch is the way to block everyone.
    if (unticking && newAllowed.length === 0) {
      toast(t.keepOnePatient, "error");
      return;
    }

    try {
      setSaving(true);
      const res = await api.updateMcpPolicy({ allowed_patient_ids: newAllowed });
      setPolicyData((prev: any) => ({
        ...prev,
        policy: { ...prev.policy, allowed_patient_ids: res.policy.allowed_patient_ids },
      }));
      toast("Patient privacy boundary updated.", "ok");
    } catch {
      toast("Failed to update privacy settings.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateKey() {
    try {
      setSaving(true);
      const res = await api.generateMcpKey("Claude Desktop / Cursor");
      setRawGeneratedKey(res.raw_key);
      // Re-fetch the full policy so owner_id and all fields are populated
      const freshPolicy = await api.mcpPolicy().catch(() => null);
      if (freshPolicy) {
        setPolicyData(freshPolicy);
      } else {
        setPolicyData((prev: any) => ({
          ...(prev || {}),
          policy: {
            ...(prev?.policy || {}),
            is_active: true,
            has_generated_key: true,
            masked_key: res.masked_key,
            key_created_at: res.created_at,
          },
        }));
      }
      toast("New Personal MCP Access Key generated!", "ok");
    } catch {
      toast("Failed to generate key.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeKey() {
    if (!confirm("Are you sure you want to revoke your MCP key? All connected tools (Claude Desktop, Cursor) will immediately lose access.")) {
      return;
    }
    try {
      setSaving(true);
      await api.revokeMcpKey();
      setRawGeneratedKey(null);
      setPolicyData((prev: any) => ({
        ...prev,
        policy: {
          ...prev.policy,
          is_active: false,
          has_generated_key: false,
          masked_key: null,
        },
      }));
      toast("MCP Access Key successfully revoked.", "ok");
    } catch {
      toast("Failed to revoke key.", "error");
    } finally {
      setSaving(false);
    }
  }

  const claudeConfigSnippet = JSON.stringify(
    {
      mcpServers: {
        "personal-health-copilot": {
          command: "python",
          args: ["backend/mcp_server.py", "--api-key", rawGeneratedKey || policyData?.policy?.masked_key || "<YOUR_MCP_KEY>"],
        },
      },
    },
    null,
    2
  );

  function copyText(text: string, type: "key" | "config") {
    navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    }
    toast("Copied to clipboard!", "ok");
  }

  const policy = policyData?.policy;
  const isAllPatientsAllowed = !policy?.allowed_patient_ids || policy.allowed_patient_ids.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="mcp-title">
      <div className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[20px] bg-surface text-fg shadow-2xl ring-1 ring-line">
        {/* Modal Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ok-soft text-ok sm:flex">
              <ShieldCheck size={22} weight="bold" />
            </div>
            <div>
              <h2 id="mcp-title" className="display text-[19px] font-semibold leading-tight sm:text-[21px]">ChatGPT & AI app access</h2>
              <p className="mt-0.5 text-[13px] text-fg-3">Choose what Claude, ChatGPT or Cursor can read from your family&apos;s records, and turn it off any time.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-fg-2 transition-colors hover:bg-hover hover:text-fg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Identity & Scope Banner */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-canvas/50 px-4 py-2.5 text-xs sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
            <span className="text-fg-3">Signed in as</span>
            <span className="min-w-0 truncate font-medium text-fg">{email}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fg-3">Owner ID:</span>
            <span className="font-mono text-fg-2">{policyData?.owner_id?.slice(0, 16) || "loading..."}...</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-canvas px-3 [scrollbar-width:none] sm:px-6" role="tablist">
          {[
            { id: "keys", label: "Access key", icon: Key },
            { id: "tools", label: "What apps can read", icon: ShieldCheck },
            { id: "privacy", label: "Family members", icon: Lock },
            { id: "audit", label: "Access log", icon: Sparkle },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cx(
                  "flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[13px] font-medium transition-colors",
                  active
                    ? "border-fg text-fg"
                    : "border-transparent text-fg-3 hover:text-fg"
                )}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="py-12 text-center text-fg-3 text-sm">Loading security policy...</div>
          ) : (
            <>
              {/* TAB 1: KEYS & CONNECTION */}
              {activeTab === "keys" && (
                <div className="space-y-5">
                  {/* Master Switch Card */}
                  <div className="flex items-center justify-between gap-4 rounded-2xl bg-canvas/50 p-4 ring-1 ring-line">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Allow AI apps to connect</span>
                        <span
                          className={cx(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            policy?.is_active
                              ? "bg-ok-soft text-ok ring-1 ring-ok/25"
                              : "bg-high-soft text-high ring-1 ring-high/30"
                          )}
                        >
                          {policy?.is_active ? "On" : "Off"}
                        </span>
                      </div>
                      <p className="text-xs text-fg-3 mt-1">
                        When off, every request from Claude, ChatGPT or Cursor is refused straight away.
                      </p>
                    </div>
                    <button
                      onClick={() => handleToggleMaster(!policy?.is_active)}
                      disabled={saving}
                      role="switch"
                      aria-checked={!!policy?.is_active}
                      aria-label="Allow AI apps to connect"
                      className={cx(
                        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none",
                        policy?.is_active ? "bg-ok" : "bg-line-strong"
                      )}
                    >
                      <span
                        className={cx(
                          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out mt-0.5 ml-0.5",
                          policy?.is_active ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>

                  {/* Active Key Display or Generate Key */}
                  <div className="rounded-2xl border border-line bg-canvas/50 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-fg">Personal MCP Access Key (PAT)</h3>
                        <p className="text-xs text-fg-3">
                          This token uniquely tells the MCP server that <strong>YOU</strong> are using it, scoping all queries strictly to your family records.
                        </p>
                      </div>
                      {policy?.has_generated_key && (
                        <button
                          onClick={handleRevokeKey}
                          disabled={saving}
                          className="rounded-xl border border-high/30 bg-high-soft px-3 py-1.5 text-xs font-medium text-high hover:bg-high-soft transition-colors"
                        >
                          Revoke Access Key
                        </button>
                      )}
                    </div>

                    {rawGeneratedKey ? (
                      <div className="rounded-xl border border-ok/30 bg-ok-soft p-4 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-ok">
                          <CheckCircle size={16} />
                          New Access Key Generated Successfully!
                        </div>
                        <p className="text-xs text-fg-2">
                          Copy this key now. For your security, this raw key will not be displayed again.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={rawGeneratedKey}
                            className="flex-1 rounded-lg bg-subtle px-3 py-2 font-mono text-xs text-fg ring-1 ring-line select-all"
                          />
                          <button
                            onClick={() => copyText(rawGeneratedKey, "key")}
                            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-fg hover:opacity-85 transition-colors"
                          >
                            {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                            {copiedKey ? "Copied" : "Copy Key"}
                          </button>
                        </div>
                      </div>
                    ) : policy?.has_generated_key ? (
                      <div className="flex items-center justify-between rounded-xl bg-subtle px-4 py-3 ring-1 ring-line">
                        <div className="space-y-0.5">
                          <div className="font-mono text-xs text-fg">{policy.masked_key}</div>
                          <div className="text-[10px] text-fg-3">Created: {new Date(policy.key_created_at || Date.now()).toLocaleDateString()}</div>
                        </div>
                        <button
                          onClick={handleGenerateKey}
                          disabled={saving}
                          className="text-xs text-ok hover:text-ok underline"
                        >
                          Regenerate Key
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-6 border border-dashed border-line rounded-xl space-y-3">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-fg-3">
                          <Key size={20} />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-fg-2">No active MCP key for this account</p>
                          <p className="text-[11px] text-fg-3 max-w-sm mx-auto mt-0.5">
                            Generate a token to allow Claude Desktop or Cursor IDE to securely query your family records.
                          </p>
                        </div>
                        <button
                          onClick={handleGenerateKey}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-85"
                        >
                          <Key size={14} />
                          Generate Personal MCP Key
                        </button>
                      </div>
                    )}

                    {/* Pre-formatted Claude Configuration */}
                    <div className="space-y-2 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-fg-2">Claude Desktop Configuration Snippet</span>
                        <button
                          onClick={() => copyText(claudeConfigSnippet, "config")}
                          className="flex items-center gap-1 text-[11px] text-ok hover:underline"
                        >
                          {copiedConfig ? <Check size={12} /> : <Copy size={12} />}
                          {copiedConfig ? "Copied" : "Copy Config JSON"}
                        </button>
                      </div>
                      <pre className="rounded-xl bg-subtle p-3 font-mono text-[11px] text-fg-2 overflow-x-auto ring-1 ring-line">
                        {claudeConfigSnippet}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: TOOL GOVERNANCE */}
              {activeTab === "tools" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">Granular Tool Governance & Permissions</h3>
                    <p className="text-xs text-fg-3">
                      Enable or disable individual clinical capabilities. Disabled tools cannot be called by any connected AI agent.
                    </p>
                  </div>

                  <div className="divide-y divide-line rounded-2xl border border-line bg-canvas/50 overflow-hidden">
                    {policyData?.available_tools?.map((toolName: string) => {
                      const meta = TOOL_DESCRIPTIONS[toolName] || {
                        label: toolName,
                        desc: "MCP clinical tool",
                        category: "Tool",
                      };
                      const isEnabled = policy?.enabled_tools?.includes(toolName);
                      return (
                        <div key={toolName} className="flex items-center justify-between p-4 hover:bg-canvas/50 transition-colors">
                          <div className="space-y-0.5 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-fg">{meta.label}</span>
                              <span className="rounded bg-subtle px-1.5 py-0.5 text-[9px] uppercase font-mono text-fg-3">
                                {meta.category}
                              </span>
                            </div>
                            <p className="text-[11px] text-fg-3">{meta.desc}</p>
                            <code className="text-[10px] text-ok font-mono">{toolName}</code>
                          </div>
                          <button
                            onClick={() => handleToggleTool(toolName)}
                            disabled={saving}
                            className={cx(
                              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none",
                              isEnabled ? "bg-ok" : "bg-line-strong"
                            )}
                          >
                            <span
                              className={cx(
                                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out mt-0.5 ml-0.5",
                                isEnabled ? "translate-x-4" : "translate-x-0"
                              )}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: FAMILY PRIVACY BOUNDARIES */}
              {activeTab === "privacy" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">Family Privacy Boundary Filter</h3>
                    <p className="text-xs text-fg-3">
                      Decide exactly which family members are accessible through external MCP AI tools. Unchecked family members are completely hidden from LLMs.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-line bg-canvas/50 p-4 space-y-3">
                    <div className="text-xs font-medium text-fg-2">
                      {isAllPatientsAllowed ? "Every family member can be read by connected apps." : "Only the ticked family members can be read."}
                    </div>

                    <div className="space-y-2">
                      {profiles.map((p) => {
                        const isAllowed = isAllPatientsAllowed || policy?.allowed_patient_ids?.includes(p.id);
                        return (
                          <button
                            type="button"
                            key={p.id}
                            role="checkbox"
                            aria-checked={!!isAllowed}
                            disabled={saving}
                            onClick={() => handleTogglePatientPrivacy(p.id)}
                            className={cx(
                              "flex min-h-11 w-full items-center justify-between rounded-xl border p-3 text-left transition-colors",
                              isAllowed
                                ? "border-ok/30 bg-ok/[0.05]"
                                : "border-line bg-subtle opacity-60"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={cx(
                                  "h-4 w-4 rounded flex items-center justify-center border",
                                  isAllowed ? "bg-ok border-ok text-surface" : "border-line-strong"
                                )}
                              >
                                {isAllowed && <Check size={12} weight="bold" />}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-fg">{p.name}</div>
                                <div className="text-[10px] text-fg-3">
                                  {p.relation} • {p.age ? `${p.age} yrs` : "Age not recorded"} • {p.sex || "Sex unrecorded"}
                                </div>
                              </div>
                            </div>
                            <span className="text-[11px] font-medium text-fg-3">
                              {isAllowed ? "Allowed" : "Hidden"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-fg-3">{t.keepOnePatient}</p>
                  </div>
                </div>
              )}

              {/* TAB 4: LIVE AUDIT TRAIL */}
              {activeTab === "audit" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-fg">Live Activity & Audit Trail</h3>
                      <p className="text-xs text-fg-3">
                        Real-time record of all MCP tool executions from Claude Desktop, Cursor, or ChatGPT.
                      </p>
                    </div>
                    <span className="text-xs text-fg-3 font-mono">{auditLogs.length} events logged</span>
                  </div>

                  {auditLogs.length === 0 ? (
                    <div className="py-12 text-center text-xs text-fg-3 border border-dashed border-line rounded-2xl">
                      No external MCP queries recorded yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-line rounded-2xl border border-line bg-canvas/50 max-h-80 overflow-y-auto">
                      {auditLogs.map((log) => (
                        <div key={log.id} className="p-3 text-xs flex items-center justify-between hover:bg-canvas/50">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-medium text-ok">{log.tool_name}</span>
                              <span
                                className={cx(
                                  "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase",
                                  log.status === "SUCCESS"
                                    ? "bg-ok-soft text-ok"
                                    : log.status === "REVOKED"
                                    ? "bg-high-soft text-high"
                                    : "bg-warn-soft text-warn"
                                )}
                              >
                                {log.status}
                              </span>
                            </div>
                            <div className="text-[10px] text-fg-3">
                              Patient: <span className="text-fg-2">{log.patient_name || "General / Family"}</span> • Client: <span className="text-fg-2">{log.client_info || "MCP stdio"}</span>
                            </div>
                          </div>
                          <span className="text-[10px] text-fg-3 font-mono">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-canvas px-4 py-3 text-xs text-fg-3 sm:px-6">
          <div className="flex items-center gap-1.5">
            <Lock size={14} className="text-ok" />
            <span>Apps only ever see the records in your own account.</span>
          </div>
          <button
            onClick={onClose}
            className="h-10 shrink-0 rounded-full bg-accent px-5 text-[13px] font-semibold text-accent-fg transition-opacity hover:opacity-85"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
