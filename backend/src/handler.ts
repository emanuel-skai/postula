import { randomUUID, createHash } from "node:crypto";
import config from "./config.json" with { type: "json" };
import calib from "./calibration_pairs.json" with { type: "json" };
import { HttpError, requireUser, loginPayload, doLogin, isAdmin } from "./auth.js";
import { userPk, CATALOG_PK, getItem, putItem, deleteItem, queryPrefix, deleteAllForPk, addCounters } from "./db.js";
import { checkExclusion, normalizeCompany } from "./exclusion.js";
import { splitLines, coverage, rankProfiles, bestThreshold, findGenericPhrases, cosine, type ProfileResult } from "./match.js";
import { embed, pingCohere, type EmbedStats } from "./embeddings.js";
import { SEED_PROFILES, SEED_VACANCIES, GENERIC_SAMPLE } from "./seed.js";

type Ev = {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
};

const MAX_PROFILES = 3;
const MAX_TEXT = 8000;
const now = () => new Date().toISOString();
const id = () => randomUUID().slice(0, 8);

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

function str(v: unknown, field: string, max = 200, required = true): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new HttpError(400, `Falta «${field}»`);
  if (s.length > max) throw new HttpError(400, `«${field}» es demasiado largo (máx. ${max} caracteres)`);
  return s;
}

// ---------- estado del usuario ----------

async function loadState(pk: string) {
  // 4 consultas por prefijo (evita traer los vectores EMB# en cada carga)
  const [p, e, v, a] = await Promise.all(["PROFILE#", "EXCL#", "VAC#", "APP#"].map((x) => queryPrefix(pk, x)));
  const profiles = p.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const exclusions = e.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const vacancies = v.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const applications = a.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  return { profiles, exclusions, vacancies, applications };
}

function profilesHash(profiles: any[]) {
  return createHash("sha1")
    .update(profiles.map((p) => `${p.id}|${p.name}|${p.cv}`).join("\n"))
    .digest("hex")
    .slice(0, 12);
}

function decorateVacancy(v: any, exclusions: any[], profiles: any[], applications: any[]) {
  const verdict = checkExclusion(v.company, exclusions.map((e) => e.name), v.acknowledged ?? []);
  const app = applications.find((a) => a.vacancyId === v.id);
  return {
    ...v,
    verdict,
    applicationId: app?.id ?? null,
    applicationStatus: app?.status ?? null,
    analysisStale: v.analysis ? v.analysis.profilesHash !== profilesHash(profiles) || v.analysis.tau !== config.tau || v.analysis.model !== config.model : false,
  };
}

function requireAdmin(addr: string) {
  if (!isAdmin(addr)) throw new HttpError(403, "Esta acción es solo para el reclutador (administrador).");
}

async function loadCatalog() {
  const items = await queryPrefix(CATALOG_PK, "VAC#");
  return items.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

// Vacante del catálogo como la ve el candidato: veredicto de exclusión propio
// y, si ya postuló, el id de su copia personal + el estado de su solicitud.
function catalogForUser(c: any, exclusions: any[], userVacs: any[], applications: any[]) {
  const mine = userVacs.find((v) => v.catalogId === c.id);
  const app = mine ? applications.find((a) => a.vacancyId === mine.id) : null;
  return {
    id: c.id, company: c.company, title: c.title, channel: c.channel, requirements: c.requirements,
    status: c.status, publishedAt: c.publishedAt,
    verdict: checkExclusion(c.company, exclusions.map((e) => e.name), []),
    personalVacancyId: mine?.id ?? null,
    applicationStatus: app?.status ?? null,
  };
}

// Vacante del catálogo como la ve el admin (reclutador): incluye contadores.
function adminCatalogView(c: any) {
  return {
    id: c.id, company: c.company, title: c.title, channel: c.channel, requirements: c.requirements,
    status: c.status, publishedAt: c.publishedAt, updatedAt: c.updatedAt ?? c.publishedAt,
    stats: { enProceso: Math.max(0, c.cntProceso ?? 0), enviadas: Math.max(0, c.cntEnviadas ?? 0) },
  };
}

async function publicState(pk: string, addr: string) {
  const s = await loadState(pk);
  const catalogRaw = await loadCatalog();
  const admin = isAdmin(addr);
  return {
    profiles: s.profiles.map(({ pk: _p, sk: _s, ...p }) => p),
    exclusions: s.exclusions.map(({ pk: _p, sk: _s, ...e }) => e),
    vacancies: s.vacancies.map(({ pk: _p, sk: _s, ...v }) => decorateVacancy(v, s.exclusions, s.profiles, s.applications)),
    applications: s.applications.map(({ pk: _p, sk: _s, ...a }) => a),
    catalog: catalogRaw.filter((c) => c.status === "open").map((c) => catalogForUser(c, s.exclusions, s.vacancies, s.applications)),
    isAdmin: admin,
    adminCatalog: admin ? catalogRaw.map(adminCatalogView) : undefined,
    engine: { engine: config.engine, model: config.model, tau: config.tau },
  };
}

// ---------- análisis por embeddings ----------

async function analyzeVacancy(pk: string, vac: any, profiles: any[]) {
  const t0 = Date.now();
  const requirements = splitLines(vac.requirements, config.minWords, config.maxLinesPerSide);
  if (!requirements.length)
    throw new HttpError(400, `La vacante no tiene requisitos válidos (cada línea necesita al menos ${config.minWords} palabras).`);
  if (!profiles.length) throw new HttpError(400, "Primero agrega al menos un perfil en «Mis perfiles».");

  const stats: EmbedStats = { requested: 0, cached: 0, computed: 0, ms: 0 };
  const Q = await embed(requirements, config.model, config.queryInputType as any, pk, stats);
  const results: ProfileResult[] = [];
  for (const p of profiles) {
    const lines = splitLines(p.cv, config.minWords, config.maxLinesPerSide);
    const D = lines.length ? await embed(lines, config.model, config.documentInputType as any, pk, stats) : [];
    results.push({ profileId: p.id, profileName: p.name, ...coverage(requirements, Q, lines, D, config.tau) });
  }
  const ranked = rankProfiles(results);
  const tie = ranked.length > 1 && ranked[0].covered === ranked[1].covered;
  return {
    model: config.model,
    tau: config.tau,
    at: now(),
    ms: Date.now() - t0,
    stats,
    profilesHash: profilesHash(profiles),
    requirements,
    recommendedProfileId: ranked[0]?.covered ? ranked[0].profileId : ranked[0]?.profileId ?? null,
    tieBrokenByMean: tie,
    ranked,
  };
}

function buildDraft(vac: any, best: ProfileResult | undefined) {
  const evid = (best?.requirements ?? []).filter((r) => r.covered && r.evidence);
  const lines = [
    `Estimado equipo de selección de ${vac.company}:`,
    "",
    GENERIC_SAMPLE,
    "",
    `Me postulo al puesto de ${vac.title}.`,
  ];
  if (evid.length) {
    lines.push("", "Algunos ejemplos de mi experiencia relacionados con lo que buscan:");
    const seen = new Set<string>();
    for (const r of evid) {
      if (seen.has(r.evidence!)) continue;
      seen.add(r.evidence!);
      lines.push(`• ${r.evidence}.`);
    }
  }
  lines.push("", "Quedo atenta a sus comentarios.", "Ana Solano (ficticia)");
  return lines.join("\n");
}

// ---------- calibración (Tabla 11) ----------

async function runCalibration(model: string) {
  if (!config.calibrationModels.includes(model)) throw new HttpError(400, "Modelo no permitido para calibración");
  const pairs = calib.pairs;
  const t0 = Date.now();
  const Q = await embed(pairs.map((p) => p.req), model, "search_query", null);
  const tq = Date.now() - t0;
  const D = await embed(pairs.map((p) => p.line), model, "search_document", null);
  const ms = Date.now() - t0;
  const scored = pairs.map((p, i) => ({ ...p, score: Number(cosine(Q[i], D[i]).toFixed(4)) }));
  const summarize = (sub: typeof scored) => {
    const b = bestThreshold(sub);
    return { pairs: sub.length, tau: b.tau, tauRange: b.range, f1: Number(b.f1.toFixed(3)), precision: Number(b.precision.toFixed(3)), recall: Number(b.recall.toFixed(3)) };
  };
  const setA = summarize(scored.filter((p) => p.set === "A"));
  const all = summarize(scored);
  const result = {
    model,
    dim: Q[0].length,
    msTotal: ms,
    msPerText: Number((ms / (pairs.length * 2)).toFixed(1)),
    msQueries: tq,
    setA,
    all,
    tau: all.tau,
    f1: all.f1,
    scored,
    at: now(),
  };
  await putItem({ pk: "CALIB", sk: `MODEL#${model}`, ...result });
  return result;
}

// ---------- router ----------

async function route(ev: Ev) {
  const method = ev.requestContext.http.method;
  const path = ev.rawPath.replace(/\/+$/, "") || "/";
  const q = new URLSearchParams(ev.rawQueryString ?? "");
  const rawBody = ev.body ? (ev.isBase64Encoded ? Buffer.from(ev.body, "base64").toString("utf8") : ev.body) : "";
  let body: any = {};
  if (rawBody) {
    try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, "JSON inválido"); }
  }
  const seg = path.split("/").filter(Boolean); // ["api", ...]
  if (seg[0] !== "api") throw new HttpError(404, "No encontrado");
  const r = seg.slice(1);
  const is = (m: string, ...parts: string[]) =>
    method === m && r.length === parts.length && parts.every((p, i) => p === "*" || p === r[i]);

  // públicos
  if (is("GET", "health")) return json(200, { ok: true, engine: config.engine, model: config.model, tau: config.tau });
  if (is("GET", "auth", "payload")) return json(200, await loginPayload(str(q.get("address"), "address", 64), q.get("chainId") ?? undefined));
  if (is("POST", "auth", "login")) return json(200, await doLogin(body));
  if (is("GET", "calibration")) {
    const items = await queryPrefix("CALIB", "MODEL#");
    return json(200, { pairs: calib.pairs.length, results: items.map(({ pk: _p, sk: _s, ...x }) => x), current: { model: config.model, tau: config.tau } });
  }

  const addr = await requireUser(ev.headers?.authorization);
  const pk = userPk(addr);

  if (is("GET", "auth", "me")) return json(200, { address: addr });
  if (is("GET", "state")) return json(200, await publicState(pk, addr));

  if (is("GET", "engine")) {
    const ping = await pingCohere(config.model);
    return json(200, { ...config, ping });
  }
  if (is("POST", "calibration", "run")) return json(200, await runCalibration(str(body.model, "model", 60)));

  // datos
  if (is("DELETE", "me")) {
    const n = await deleteAllForPk(pk);
    return json(200, { deleted: n });
  }
  if (is("POST", "seed")) {
    // Onboarding del candidato: solo carga los perfiles de ejemplo (Ana Solano).
    // Las vacantes viven en el catálogo del reclutador, no se crean por usuario.
    await deleteAllForPk(pk);
    const t = Date.now();
    let k = 0;
    const ts = () => new Date(t + k++).toISOString();
    for (const p of SEED_PROFILES) {
      const pid = id();
      await putItem({ pk, sk: `PROFILE#${pid}`, id: pid, ...p, createdAt: ts(), updatedAt: ts() });
    }
    return json(200, await publicState(pk, addr));
  }

  // perfiles
  if (is("POST", "profiles")) {
    const existing = await queryPrefix(pk, "PROFILE#");
    if (existing.length >= MAX_PROFILES) throw new HttpError(400, `Máximo ${MAX_PROFILES} perfiles.`);
    const pid = id();
    const item = { pk, sk: `PROFILE#${pid}`, id: pid, name: str(body.name, "nombre", 80), cv: str(body.cv, "CV", MAX_TEXT, false), createdAt: now(), updatedAt: now() };
    await putItem(item);
    return json(200, await publicState(pk, addr));
  }
  if (is("PUT", "profiles", "*")) {
    const cur = await getItem(pk, `PROFILE#${r[1]}`);
    if (!cur) throw new HttpError(404, "Perfil no encontrado");
    await putItem({ ...cur, name: str(body.name, "nombre", 80), cv: str(body.cv, "CV", MAX_TEXT, false), updatedAt: now() });
    return json(200, await publicState(pk, addr));
  }
  if (is("DELETE", "profiles", "*")) {
    await deleteItem(pk, `PROFILE#${r[1]}`);
    return json(200, await publicState(pk, addr));
  }

  // exclusiones
  if (is("POST", "exclusions")) {
    const name = str(body.name, "empresa", 120);
    if (!normalizeCompany(name)) throw new HttpError(400, "Escribe un nombre de empresa válido");
    const list = await queryPrefix(pk, "EXCL#");
    if (list.some((e) => normalizeCompany(e.name) === normalizeCompany(name)))
      throw new HttpError(409, "Esa empresa ya está en tu lista de exclusión");
    const eid = id();
    await putItem({ pk, sk: `EXCL#${eid}`, id: eid, name, normalized: normalizeCompany(name), createdAt: now() });
    return json(200, await publicState(pk, addr));
  }
  if (is("DELETE", "exclusions", "*")) {
    await deleteItem(pk, `EXCL#${r[1]}`);
    return json(200, await publicState(pk, addr));
  }

  // --- catálogo del reclutador (admin) ---
  if (is("POST", "catalog")) {
    requireAdmin(addr);
    const vid = id();
    await putItem({
      pk: CATALOG_PK, sk: `VAC#${vid}`, id: vid,
      company: str(body.company, "empresa", 120),
      title: str(body.title, "puesto", 120),
      channel: str(body.channel, "canal", 120, false) || "Publicada por el reclutador",
      requirements: str(body.requirements, "requisitos", MAX_TEXT),
      status: "open", publishedBy: addr, publishedAt: now(), updatedAt: now(),
      cntProceso: 0, cntEnviadas: 0,
    });
    return json(200, await publicState(pk, addr));
  }
  if (is("PUT", "catalog", "*")) {
    requireAdmin(addr);
    const cur = await getItem(CATALOG_PK, `VAC#${r[1]}`);
    if (!cur) throw new HttpError(404, "Vacante no encontrada");
    await putItem({
      ...cur,
      company: str(body.company, "empresa", 120),
      title: str(body.title, "puesto", 120),
      channel: str(body.channel, "canal", 120, false) || cur.channel,
      requirements: str(body.requirements, "requisitos", MAX_TEXT),
      updatedAt: now(),
    });
    return json(200, await publicState(pk, addr));
  }
  if (is("POST", "catalog", "*", "status")) {
    requireAdmin(addr);
    const cur = await getItem(CATALOG_PK, `VAC#${r[1]}`);
    if (!cur) throw new HttpError(404, "Vacante no encontrada");
    const status = str(body.status, "estado", 10);
    if (status !== "open" && status !== "closed") throw new HttpError(400, "Estado no válido");
    await putItem({ ...cur, status, updatedAt: now() });
    return json(200, await publicState(pk, addr));
  }
  if (is("DELETE", "catalog", "*")) {
    requireAdmin(addr);
    await deleteItem(CATALOG_PK, `VAC#${r[1]}`);
    return json(200, await publicState(pk, addr));
  }
  if (is("POST", "catalog", "seed")) {
    // Carga las 4 vacantes de ejemplo del Sprint en el catálogo (reemplaza las previas).
    requireAdmin(addr);
    const existing = await queryPrefix(CATALOG_PK, "VAC#");
    for (const c of existing) await deleteItem(CATALOG_PK, c.sk);
    const t = Date.now();
    let k = 0;
    const ts = () => new Date(t + k++).toISOString();
    for (const v of SEED_VACANCIES) {
      const vid = id();
      await putItem({ pk: CATALOG_PK, sk: `VAC#${vid}`, id: vid, ...v, status: "open", publishedBy: addr, publishedAt: ts(), updatedAt: ts(), cntProceso: 0, cntEnviadas: 0 });
    }
    return json(200, await publicState(pk, addr));
  }

  // --- candidato: postular a una vacante del catálogo (clona a su espacio) ---
  if (is("POST", "catalog", "*", "apply")) {
    const c = await getItem(CATALOG_PK, `VAC#${r[1]}`);
    if (!c) throw new HttpError(404, "Vacante no encontrada");
    if (c.status !== "open") throw new HttpError(409, "Esta vacante ya no está abierta.");
    const st = await loadState(pk);
    const verdict = checkExclusion(c.company, st.exclusions.map((e) => e.name), []);
    if (verdict.status === "blocked")
      throw new HttpError(403, "Esta empresa está en tu lista de exclusión. No puedes postularte.", { verdict });
    const mine = st.vacancies.find((v) => v.catalogId === c.id);
    if (mine) return json(200, { vacancyId: mine.id, state: await publicState(pk, addr) });
    const vid = id();
    await putItem({
      pk, sk: `VAC#${vid}`, id: vid, catalogId: c.id, source: "catalog",
      company: c.company, title: c.title, channel: c.channel, requirements: c.requirements,
      acknowledged: [], createdAt: now(),
    });
    await addCounters(CATALOG_PK, `VAC#${c.id}`, { cntProceso: 1 });
    return json(200, { vacancyId: vid, state: await publicState(pk, addr) });
  }

  // vacantes (copias personales clonadas del catálogo)
  if (is("DELETE", "vacancies", "*")) {
    const v = await getItem(pk, `VAC#${r[1]}`);
    if (v?.catalogId) {
      const app = (await queryPrefix(pk, "APP#")).find((a) => a.vacancyId === v.id);
      if (!app || app.status === "borrador" || app.status === "preparada")
        await addCounters(CATALOG_PK, `VAC#${v.catalogId}`, { cntProceso: -1 });
    }
    await deleteItem(pk, `VAC#${r[1]}`);
    return json(200, await publicState(pk, addr));
  }
  if (is("POST", "vacancies", "*", "acknowledge")) {
    // «No es la misma empresa, continuar» ante un nombre parecido (H2)
    const v = await getItem(pk, `VAC#${r[1]}`);
    if (!v) throw new HttpError(404, "Vacante no encontrada");
    const ex = str(body.exclusion, "exclusión", 120);
    await putItem({ ...v, acknowledged: [...new Set([...(v.acknowledged ?? []), ex])] });
    return json(200, await publicState(pk, addr));
  }
  if (is("POST", "vacancies", "*", "analyze")) {
    const s = await loadState(pk);
    const v = s.vacancies.find((x) => x.id === r[1]);
    if (!v) throw new HttpError(404, "Vacante no encontrada");
    const verdict = checkExclusion(v.company, s.exclusions.map((e) => e.name), v.acknowledged ?? []);
    if (verdict.status === "blocked")
      throw new HttpError(403, "Esta empresa está en tu lista de exclusión. No puedes enviar esta postulación.", { verdict });
    const analysis = await analyzeVacancy(pk, v, s.profiles);
    await putItem({ ...v, analysis });
    return json(200, { analysis, state: await publicState(pk, addr) });
  }

  // postulaciones
  if (is("POST", "applications")) {
    const s = await loadState(pk);
    const v = s.vacancies.find((x) => x.id === str(body.vacancyId, "vacancyId", 40));
    if (!v) throw new HttpError(404, "Vacante no encontrada");
    const verdict = checkExclusion(v.company, s.exclusions.map((e) => e.name), v.acknowledged ?? []);
    if (verdict.status !== "allowed")
      throw new HttpError(403, verdict.status === "blocked"
        ? "Esta empresa está en tu lista de exclusión. No puedes enviar esta postulación."
        : "Revisa el nombre de la empresa antes de preparar la postulación.", { verdict });
    const existing = s.applications.find((a) => a.vacancyId === v.id);
    if (existing) return json(200, { application: existing, state: await publicState(pk, addr) });
    const ranked: ProfileResult[] = v.analysis?.ranked ?? [];
    const chosen = ranked.find((p) => p.profileId === body.profileId) ?? ranked[0];
    const content = buildDraft(v, chosen);
    const aid = id();
    const app = {
      pk, sk: `APP#${aid}`, id: aid,
      vacancyId: v.id, company: v.company, title: v.title, channel: v.channel,
      profileId: chosen?.profileId ?? null, profileName: chosen?.profileName ?? null,
      coverage: chosen ? { covered: chosen.covered, total: chosen.total } : null,
      content, originalContent: content, edited: false,
      status: "borrador",
      timeline: [{ status: "borrador", at: now(), note: "Borrador generado. Nada se ha enviado todavía." }],
      createdAt: now(), updatedAt: now(),
    };
    await putItem(app);
    return json(200, { application: app, state: await publicState(pk, addr) });
  }
  if (is("PUT", "applications", "*")) {
    const a = await getItem(pk, `APP#${r[1]}`);
    if (!a) throw new HttpError(404, "Solicitud no encontrada");
    if (a.status !== "borrador" && a.status !== "preparada")
      throw new HttpError(409, "Esta solicitud ya fue enviada; no se puede editar.");
    const content = str(body.content, "contenido", MAX_TEXT);
    const timeline = a.status === "preparada" ? a.timeline : [...a.timeline, { status: "preparada", at: now(), note: "Guardada y lista para aprobación. Nada se ha enviado todavía." }];
    const upd = { ...a, content, edited: content !== a.originalContent, status: "preparada", timeline, updatedAt: now() };
    await putItem(upd);
    return json(200, { application: upd, generic: findGenericPhrases(content), state: await publicState(pk, addr) });
  }
  if (is("POST", "applications", "*", "send")) {
    const a = await getItem(pk, `APP#${r[1]}`);
    if (!a) throw new HttpError(404, "Solicitud no encontrada");
    if (a.status !== "preparada") throw new HttpError(409, "Primero guarda y revisa el contenido.");
    if (body.approved !== true) throw new HttpError(400, "Marca «Revisé el destinatario y el contenido. Autorizo este envío».");
    // La exclusión se re-evalúa al enviar: pudo cambiar desde que se preparó.
    const s = await loadState(pk);
    const v = s.vacancies.find((x) => x.id === a.vacancyId);
    const verdict = checkExclusion(a.company, s.exclusions.map((e) => e.name), v?.acknowledged ?? []);
    if (verdict.status !== "allowed")
      throw new HttpError(403, "Esta empresa está en tu lista de exclusión. No puedes enviar esta postulación.", { verdict });
    const upd = {
      ...a, status: "enviada", sentAt: now(), updatedAt: now(),
      timeline: [...a.timeline, { status: "enviada", at: now(), note: `Envío simulado a ${a.company}. Aún no hay confirmación de recepción.` }],
    };
    await putItem(upd);
    if (v?.catalogId) await addCounters(CATALOG_PK, `VAC#${v.catalogId}`, { cntEnviadas: 1, cntProceso: -1 });
    return json(200, { application: upd, state: await publicState(pk, addr) });
  }
  if (is("POST", "applications", "*", "evidence")) {
    const a = await getItem(pk, `APP#${r[1]}`);
    if (!a) throw new HttpError(404, "Solicitud no encontrada");
    if (a.status !== "enviada") throw new HttpError(409, "Solo una solicitud enviada puede confirmar recepción.");
    const types = ["correo_confirmacion", "acuse_portal", "contacto_reclutador"];
    const type = str(body.type, "tipo de evidencia", 40);
    if (!types.includes(type)) throw new HttpError(400, "Tipo de evidencia no válido");
    const reference = str(body.reference, "referencia de la evidencia", 300);
    const upd = {
      ...a, status: "recepcion_confirmada", evidence: { type, reference, at: now() }, updatedAt: now(),
      timeline: [...a.timeline, { status: "recepcion_confirmada", at: now(), note: "Recepción confirmada con evidencia registrada por ti." }],
    };
    await putItem(upd);
    return json(200, { application: upd, state: await publicState(pk, addr) });
  }
  if (is("DELETE", "applications", "*")) {
    const a = await getItem(pk, `APP#${r[1]}`);
    if (a && a.status !== "borrador" && a.status !== "preparada")
      throw new HttpError(409, "Una solicitud enviada no se puede borrar del historial.");
    await deleteItem(pk, `APP#${r[1]}`);
    return json(200, await publicState(pk, addr));
  }
  if (is("POST", "generic-check")) return json(200, { generic: findGenericPhrases(str(body.content, "contenido", MAX_TEXT, false)) });

  throw new HttpError(404, "Ruta no encontrada");
}

export async function handler(ev: Ev) {
  try {
    return await route(ev);
  } catch (e: any) {
    if (e instanceof HttpError) return json(e.status, { error: e.message, ...(e.extra ?? {}) });
    console.error("unhandled", e);
    return json(500, { error: "Error interno. Intenta de nuevo." });
  }
}
