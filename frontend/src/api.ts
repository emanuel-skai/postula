const BASE = (import.meta.env.VITE_API_URL as string).replace(/\/$/, "");
const TOKEN_KEY = "postula_jwt";

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t: string | null) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* sin storage */ }
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) { super(message); }
}

let onUnauthorized: () => void = () => {};
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const tok = getToken();
  if (opts.auth !== false && tok) headers.Authorization = `Bearer ${tok}`;
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "Sin conexión con el servidor. Revisa tu red e intenta de nuevo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && opts.auth !== false) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data);
  }
  return data as T;
}

// ---------- tipos ----------
export type Verdict =
  | { status: "allowed" }
  | { status: "blocked"; exclusion: string }
  | { status: "review"; exclusion: string; reason: string };

export interface Profile { id: string; name: string; cv: string; createdAt: string; updatedAt: string }
export interface Exclusion { id: string; name: string; normalized: string; createdAt: string }
export interface ReqResult { requirement: string; covered: boolean; evidence: string | null; score: number }
export interface ProfileResult { profileId: string; profileName: string; covered: number; total: number; meanScore: number; lines: number; requirements: ReqResult[] }
export interface Analysis {
  model: string; tau: number; at: string; ms: number;
  stats: { requested: number; cached: number; computed: number; ms: number };
  requirements: string[]; recommendedProfileId: string | null; tieBrokenByMean: boolean; ranked: ProfileResult[];
}
export interface Vacancy {
  id: string; company: string; title: string; channel: string; requirements: string; demo?: boolean;
  catalogId?: string; source?: string;
  acknowledged: string[]; createdAt: string; analysis?: Analysis; analysisStale: boolean;
  verdict: Verdict; applicationId: string | null; applicationStatus: AppStatus | null;
}
export type AppStatus = "borrador" | "preparada" | "enviada" | "recepcion_confirmada";
export interface Application {
  id: string; vacancyId: string; company: string; title: string; channel: string;
  profileId: string | null; profileName: string | null; coverage: { covered: number; total: number } | null;
  content: string; originalContent: string; edited: boolean; status: AppStatus;
  timeline: { status: AppStatus; at: string; note: string }[];
  evidence?: { type: string; reference: string; at: string };
  sentAt?: string; createdAt: string; updatedAt: string;
}
export type CatalogStatus = "open" | "closed";
// Vacante publicada por el reclutador, como la ve el candidato.
export interface CatalogVacancy {
  id: string; company: string; title: string; channel: string; requirements: string;
  status: CatalogStatus; publishedAt: string;
  verdict: Verdict;
  personalVacancyId: string | null;
  applicationStatus: AppStatus | null;
}
// Vacante del catálogo como la ve el admin (reclutador): incluye contadores.
export interface AdminVacancy {
  id: string; company: string; title: string; channel: string; requirements: string;
  status: CatalogStatus; publishedAt: string; updatedAt: string;
  stats: { enProceso: number; enviadas: number };
}
export interface AppState {
  profiles: Profile[]; exclusions: Exclusion[]; vacancies: Vacancy[]; applications: Application[];
  catalog: CatalogVacancy[]; isAdmin: boolean; adminCatalog?: AdminVacancy[];
  engine: { engine: string; model: string; tau: number };
}

// Misma lista que el servidor (detección inmediata mientras se escribe).
const GENERIC = [
  "me interesa cualquier puesto", "cualquier puesto disponible", "a quien corresponda",
  "estoy dispuesto a hacer lo que sea", "estoy dispuesta a hacer lo que sea", "soy una persona proactiva",
  "soy una persona responsable", "trabajo bien bajo presion", "trabajo en equipo y bajo presion",
  "busco crecer profesionalmente", "cualquier oportunidad",
];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function findGeneric(text: string): string[] {
  return text.split(/(?<=[.!?\n])/).map((s) => s.trim()).filter((s) => s && GENERIC.some((g) => norm(s).includes(g)));
}
