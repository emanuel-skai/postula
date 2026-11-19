// Exclusión de empresas — sin IA (guía §Lógica 7, hallazgo H2).
// Normaliza: minúsculas, sin tildes, sin puntuación, sin sufijos societarios.

const SUFFIXES = [
  "sociedad anonima",
  "sociedad de responsabilidad limitada",
  "s a s",
  "sas",
  "s r l",
  "srl",
  "s a",
  "sa",
  "ltda",
  "ltd",
  "limitada",
  "inc",
  "corp",
  "corporation",
  "llc",
  "co",
];

export function normalizeCompany(name: string): string {
  let s = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Quitar sufijos societarios al final (repetido: "Foo S.A. Inc.")
  let changed = true;
  while (changed && s.length) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (s === suf) break;
      if (s.endsWith(" " + suf)) {
        s = s.slice(0, -(suf.length + 1)).trim();
        changed = true;
      }
    }
  }
  return s;
}

export type ExclusionVerdict =
  | { status: "allowed" }
  | { status: "blocked"; exclusion: string }
  | { status: "review"; exclusion: string; reason: string };

function containsWords(hay: string, needle: string): boolean {
  if (!needle) return false;
  return (" " + hay + " ").includes(" " + needle + " ");
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

/**
 * Compara la empresa de una vacante con la lista de exclusión.
 * - blocked: mismo nombre normalizado → no se puede postular.
 * - review: un nombre contiene al otro o son casi iguales → la persona decide.
 * `acknowledged` = exclusiones que la persona ya revisó y decidió que NO son la misma empresa.
 */
export function checkExclusion(
  company: string,
  exclusions: string[],
  acknowledged: string[] = [],
): ExclusionVerdict {
  const c = normalizeCompany(company);
  const ack = new Set(acknowledged.map(normalizeCompany));
  let review: ExclusionVerdict | null = null;
  for (const ex of exclusions) {
    const e = normalizeCompany(ex);
    if (!e) continue;
    if (e === c) return { status: "blocked", exclusion: ex };
    if (review || ack.has(e)) continue;
    if (containsWords(c, e) || containsWords(e, c)) {
      review = { status: "review", exclusion: ex, reason: "El nombre contiene el de una empresa excluida." };
    } else {
      const d = levenshtein(c, e);
      const ratio = 1 - d / Math.max(c.length, e.length);
      if (ratio >= 0.85)
        review = { status: "review", exclusion: ex, reason: "El nombre es muy parecido al de una empresa excluida." };
    }
  }
  return review ?? { status: "allowed" };
}
