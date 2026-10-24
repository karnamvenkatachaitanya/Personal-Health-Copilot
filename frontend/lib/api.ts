import { supabase } from "./supabase";
import type { CareItem, CarePlan, CopilotAnswer, FamilyToday, FileUrls, HealthRecord, Lang, Profile, Trend } from "./types";

export function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    const custom = window.localStorage.getItem("copilot_backend_url");
    if (custom) return custom.replace(/\/+$/, "");
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://localhost:8000/api/v1";
    }
  }
  return (process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.mycopilot.qd.je/api/v1").replace(/\/+$/, "");
}

/** The user's own calendar day (YYYY-MM-DD), so "today" matches their clock, not the server's. */
export function localDay(d = new Date()): string {
  return d.toLocaleDateString("en-CA");
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function getFreshToken(): Promise<string | undefined> {
  const client = supabase();
  const { data } = await client.auth.getSession();
  let session = data.session;
  if (!session) return undefined;

  // If token is expired or expiring in the next 60 seconds, refresh proactively
  if (session.expires_at && session.expires_at * 1000 - Date.now() < 60000) {
    try {
      const { data: refreshed, error } = await client.auth.refreshSession();
      if (!error && refreshed.session) {
        session = refreshed.session;
      }
    } catch {
      // Proceed with current session if refresh network check fails
    }
  }
  return session?.access_token;
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 30000, isRetry = false): Promise<T> {
  const token = await getFreshToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  const base = getBaseUrl();
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch (e) {
    throw new ApiError(0, (e as Error).name === "AbortError"
      ? "This is taking longer than expected. Please try again."
      : "Cannot reach the server. Check that the backend is running.");
  } finally {
    clearTimeout(timer);
  }

  // If 401 Unauthorized, attempt to refresh session once and retry
  if (res.status === 401 && !isRetry) {
    try {
      const { data: refreshed, error } = await supabase().auth.refreshSession();
      if (!error && refreshed.session?.access_token) {
        return call<T>(path, init, timeoutMs, true);
      } else {
        await supabase().auth.signOut().catch(() => {});
      }
    } catch {
      await supabase().auth.signOut().catch(() => {});
    }
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = body?.detail;
    const message = typeof d === "string" ? d : d?.message || "Something went wrong. Please try again.";
    throw new ApiError(res.status, message, typeof d === "object" ? d?.code : undefined);
  }
  return body as T;
}

const json = (b: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

export const api = {
  profiles: () => call<Profile[]>("/profiles"),
  createProfile: (p: { name: string; relation: string; age?: string; sex?: string }) => call<Profile>("/profiles", json(p)),
  deleteProfile: (id: string) => call<void>(`/profiles/${id}`, { method: "DELETE" }),
  linkAbha: (id: string, b: { abha_number?: string; abha_address?: string }) => call<Profile>(`/profiles/${id}/abha`, json(b)),
  unlinkAbha: (id: string) => call<Profile>(`/profiles/${id}/abha`, { method: "DELETE" }),
  records: (profileId?: string) => call<HealthRecord[]>(profileId ? `/health-records?profile_id=${profileId}` : "/health-records"),
  upload: (file: File, profileId: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("profile_id", profileId);
    return call<HealthRecord>("/health-records/upload", { method: "POST", body: fd }, 180000);
  },
  sourceUrl: (id: string, variant: "original" | "preview" = "original") => call<{ url: string }>(`/health-records/${id}/file?variant=${variant}`),
  fileUrls: (profileId?: string) => call<{ urls: FileUrls }>(profileId ? `/health-records/files?profile_id=${profileId}` : "/health-records/files"),
  moveRecord: (id: string, profileId: string) => call<HealthRecord>(`/health-records/${id}/move`, json({ profile_id: profileId })),
  deleteRecord: (id: string) => call<void>(`/health-records/${id}`, { method: "DELETE" }),
  ask: (
    query: string,
    language: Lang,
    profileId: string,
    location?: { lat?: number; lon?: number; city?: string },
    history?: { role: "user" | "assistant"; content: string }[]
  ) =>
    call<CopilotAnswer>(
      "/copilot/query",
      json({
        query,
        language,
        profile_id: profileId,
        ...(location || {}),
        ...(history && history.length > 0 ? { history } : {})
      }),
      90000
    ),
  findDoctors: (profileId: string, language: Lang, params?: { query?: string; city?: string; lat?: number; lon?: number }) =>
    call<import("./types").DoctorRecommendation[]>("/copilot/doctors", json({ profile_id: profileId, language, ...(params || {}) }), 30000),
  transcribe: (audio: Blob, language: Lang) => {
    const ext = audio.type.includes("mp4") ? "mp4" : audio.type.includes("wav") ? "wav" : audio.type.includes("ogg") ? "ogg" : "webm";
    const fd = new FormData();
    fd.append("audio", audio, `speech.${ext}`);
    fd.append("language", language);
    return call<{ text: string }>("/voice/transcribe", { method: "POST", body: fd }, 60000);
  },
  /** Spoken audio for one sentence, fetched with the user's token (the endpoint is not public). */
  tts: async (text: string, language: Lang): Promise<Blob> => {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`${getBaseUrl()}/voice/tts?text=${encodeURIComponent(text.slice(0, 600))}&language=${language}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, "Speech is not available right now.");
    return res.blob();
  },
  trends: (profileId: string) => call<Trend[]>(`/profiles/${profileId}/trends`),
  carePlan: (profileId: string, date = localDay()) => call<CarePlan>(`/profiles/${profileId}/care-plan?date=${date}`),
  familyToday: (date = localDay()) => call<FamilyToday>(`/care-plan/today?date=${date}`),
  addCareItem: (profileId: string, body: Partial<CareItem>) => call<CareItem>(`/profiles/${profileId}/care-items`, json(body)),
  editCareItem: (id: string, patch: Partial<CareItem>) =>
    call<CareItem>(`/care-items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
  logCare: (id: string, body: { action: "taken" | "skipped" | "snoozed" | "done" | "reopened"; dose_date?: string; dose_time?: string; snooze_minutes?: number }) =>
    call<unknown>(`/care-items/${id}/log`, json(body)),
  /** Downloads the reminders as an .ics file; the phone's calendar then rings at each dose. */
  downloadCalendar: async (profileId: string, name: string, language: Lang) => {
    const token = await getFreshToken();
    const res = await fetch(`${getBaseUrl()}/profiles/${profileId}/care-plan.ics?lang=${language}&date=${localDay()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, "Could not create the calendar file. Please try again.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await res.blob());
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-reminders.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  loadSample: () => call<{ records: number }>("/sample-family", { method: "POST" }, 120000),
  exportFhir: async (profileId: string, name: string) => {
    const bundle = await call<unknown>(`/profiles/${profileId}/fhir`);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-fhir-r4.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  // Enterprise MCP Data Governance
  mcpPolicy: () =>
    call<{
      policy: {
        is_active: boolean;
        has_generated_key: boolean;
        masked_key: string | null;
        key_label?: string;
        key_created_at?: string;
        enabled_tools: string[];
        allowed_patient_ids: string[];
      };
      available_tools: string[];
      owner_id: string;
    }>("/mcp/policy"),
  generateMcpKey: (label = "Claude Desktop / Cursor") =>
    call<{
      raw_key: string;
      masked_key: string;
      created_at: string;
      label: string;
      instructions: string;
    }>("/mcp/generate-key", json({ label }), 15000),
  revokeMcpKey: () =>
    call<{ status: string; revoked_count: number; timestamp: string }>("/mcp/revoke-key", { method: "POST" }, 15000),
  updateMcpPolicy: (body: { is_active?: boolean; enabled_tools?: string[]; allowed_patient_ids?: string[] }) =>
    call<{ status: string; policy: any }>("/mcp/policy", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }, 15000),
  mcpAuditLogs: (limit = 30) =>
    call<Array<{
      id: string;
      tool_name: string;
      patient_name?: string;
      status: string;
      timestamp: string;
      client_info?: string;
      arguments?: Record<string, any>;
    }>>(`/mcp/audit-trail?limit=${limit}`),
};

