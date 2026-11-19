// Cobertura de requisitos por similitud de embeddings (guía §Lógica 1–6).

export function splitLines(text: string, minWords: number, max = 200): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-•*·\d.)]+\s*/, "").trim();
    if (line.split(/\s+/).filter(Boolean).length < minWords) continue;
    const k = line.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface RequirementResult {
  requirement: string;
  covered: boolean;
  evidence: string | null; // línea ganadora (solo si cubierto)
  score: number; // s_i = max_j S_ij — uso técnico, no se muestra como %
}

export interface ProfileResult {
  profileId: string;
  profileName: string;
  covered: number;
  total: number;
  meanScore: number;
  lines: number;
  requirements: RequirementResult[];
}

/** S = Q·Dᵀ; s_i = max_j S_ij; cubierto si s_i ≥ τ. */
export function coverage(
  requirements: string[],
  Q: number[][],
  cvLines: string[],
  D: number[][],
  tau: number,
): Omit<ProfileResult, "profileId" | "profileName"> {
  const reqs: RequirementResult[] = requirements.map((req, i) => {
    let best = -1, bestJ = -1;
    for (let j = 0; j < D.length; j++) {
      const s = cosine(Q[i], D[j]);
      if (s > best) { best = s; bestJ = j; }
    }
    const covered = bestJ >= 0 && best >= tau;
    return { requirement: req, covered, evidence: covered ? cvLines[bestJ] : null, score: Math.max(best, 0) };
  });
  const covered = reqs.filter((r) => r.covered).length;
  const meanScore = reqs.length ? reqs.reduce((a, r) => a + r.score, 0) / reqs.length : 0;
  return { covered, total: reqs.length, meanScore, lines: cvLines.length, requirements: reqs };
}

/** Recomendado = más requisitos cubiertos; empate → mayor promedio de s_i. */
export function rankProfiles(results: ProfileResult[]): ProfileResult[] {
  return [...results].sort((a, b) => b.covered - a.covered || b.meanScore - a.meanScore);
}

/**
 * τ que maximiza F1 sobre pares etiquetados. Si varios τ empatan (meseta),
 * se toma el punto medio de la primera meseta: es el más robusto ante datos nuevos.
 */
export function bestThreshold(pairs: { score: number; label: boolean }[]) {
  const evals = [];
  for (let t = 0; t <= 100; t++) evals.push(evalAt(pairs, t / 100));
  const maxF1 = Math.max(...evals.map((e) => e.f1));
  const first = evals.findIndex((e) => e.f1 === maxF1);
  let last = first;
  while (last + 1 < evals.length && evals[last + 1].f1 === maxF1) last++;
  const mid = evals[Math.round((first + last) / 2)];
  return { ...mid, range: [evals[first].tau, evals[last].tau] as [number, number] };
}

function evalAt(pairs: { score: number; label: boolean }[], tau: number) {
  {
    let tp = 0, fp = 0, fn = 0;
    for (const p of pairs) {
      const pred = p.score >= tau;
      if (pred && p.label) tp++;
      else if (pred && !p.label) fp++;
      else if (!pred && p.label) fn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { tau, f1, precision, recall };
  }
}

const GENERIC_PHRASES = [
  "me interesa cualquier puesto",
  "cualquier puesto disponible",
  "a quien corresponda",
  "estoy dispuesto a hacer lo que sea",
  "estoy dispuesta a hacer lo que sea",
  "soy una persona proactiva",
  "soy una persona responsable",
  "trabajo bien bajo presion",
  "trabajo en equipo y bajo presion",
  "busco crecer profesionalmente",
  "cualquier oportunidad",
];

/** Detección de frases genéricas (hallazgo H6). */
export function findGenericPhrases(text: string): string[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = norm(text ?? "");
  const found: string[] = [];
  for (const sentence of (text ?? "").split(/(?<=[.!?\n])/)) {
    const ns = norm(sentence);
    if (GENERIC_PHRASES.some((g) => ns.includes(g))) found.push(sentence.trim());
  }
  return t ? found.filter(Boolean) : [];
}
