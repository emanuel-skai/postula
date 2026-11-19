// E2E contra el backend desplegado: login SIWE real (potenci auth) con dos roles
// (reclutador/admin y candidato) + CU-01/02/03 sobre el NUEVO modelo de catálogo.
// No es destructivo: el admin publica vacantes con un tag único y las borra al final;
// el catálogo real del demo no se toca.
//
// Correr con la llave del admin de pruebas (nunca se imprime):
//   ( set -a; source .env.e2e; set +a; node scripts/e2e.mjs )   # .env.e2e no se versiona
// Sin POSTULA_E2E_ADMIN_KEY corre solo las verificaciones que no necesitan admin.
import { createThirdwebClient } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import { signLoginPayload } from "thirdweb/auth";
import { randomBytes } from "node:crypto";

const API = process.env.API ?? process.env.VITE_API_URL;
if (!API) throw new Error("Define API (URL de la API desplegada)");
const client = createThirdwebClient({ clientId: process.env.VITE_THIRDWEB_CLIENT_ID });
const ADMIN_KEY = process.env.POSTULA_E2E_ADMIN_KEY;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`); };

async function session(privateKey) {
  const account = privateKeyToAccount({ client, privateKey });
  const raw = async (tok, method, path, body) => {
    const r = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const payload = (await raw(null, "GET", `/api/auth/payload?address=${account.address}&chainId=1`)).data;
  const signed = await signLoginPayload({ payload, account });
  const login = await raw(null, "POST", "/api/auth/login", signed);
  const tok = login.data.token;
  return { account, tok, call: (method, path, body) => raw(tok, method, path, body) };
}

const TAG = `E2E-${randomBytes(3).toString("hex")}`;
const DATA_REQS = [
  "Experiencia construyendo dashboards e indicadores de negocio",
  "Manejo avanzado de SQL en bases de datos relacionales",
  "Automatización de procesos de limpieza de datos con Python",
  "Capacidad para presentar hallazgos a personas no técnicas",
].join("\n");

let admin = null, catDestino, catActual, catReview, catClosed;

try {
  // ---------- ADMIN (reclutador) ----------
  if (!ADMIN_KEY) {
    console.log("SKIP  pruebas de admin (sin POSTULA_E2E_ADMIN_KEY)");
  } else {
    admin = await session(ADMIN_KEY);
    check("admin login SIWE", !!admin.tok);
    check("admin isAdmin=true", (await admin.call("GET", "/api/state")).data.isAdmin === true);

    const pub = async (company, title) => {
      const r = await admin.call("POST", "/api/catalog", { company, title, requirements: DATA_REQS, channel: "E2E (simulado)" });
      check(`admin publica «${company}»`, r.status === 200, `(${r.status})`);
      return r.data.adminCatalog.find((v) => v.company === company);
    };
    catDestino = await pub(`${TAG} Destino`, "Analista de Datos");
    catActual = await pub(`${TAG} Actual`, "Analista de Datos Senior");
    catReview = await pub(`${TAG} Actual Servicios S.A.`, "Ingeniería de Datos");
    catClosed = await pub(`${TAG} Cerrada`, "Puesto cerrado");
    check("admin cierra una vacante", (await admin.call("POST", `/api/catalog/${catClosed.id}/status`, { status: "closed" })).status === 200);
    check("admin edita una vacante", (await admin.call("PUT", `/api/catalog/${catReview.id}`, { company: `${TAG} Actual Servicios S.A.`, title: "Ingeniera/o de Datos", requirements: DATA_REQS })).status === 200);
  }

  // ---------- CANDIDATO ----------
  const cand = await session("0x" + randomBytes(32).toString("hex"));
  check("candidato login SIWE", !!cand.tok);
  check("candidato auth/me = wallet", (await cand.call("GET", "/api/auth/me")).data.address === cand.account.address.toLowerCase());
  check("candidato isAdmin=false", (await cand.call("GET", "/api/state")).data.isAdmin === false);

  let s = (await cand.call("POST", "/api/seed")).data;
  check("seed: 3 perfiles, 0 vacantes (las vacantes viven en el catálogo)", s.profiles.length === 3 && s.vacancies.length === 0);
  const catItem = (company) => s.catalog.find((v) => v.company === company);

  if (admin) {
    check("catálogo muestra las vacantes abiertas del test", !!catItem(`${TAG} Destino`) && !!catItem(`${TAG} Actual`));
    check("catálogo NO muestra la vacante cerrada", !s.catalog.some((v) => v.company === `${TAG} Cerrada`));

    // CU-01: exclusión + veredicto por ítem del catálogo
    s = (await cand.call("POST", "/api/exclusions", { name: `${TAG} Actual S.A.` })).data;
    check("CU-01 exclusión bloquea «… Actual» en el catálogo", catItem(`${TAG} Actual`).verdict.status === "blocked");
    check("H2 nombre parecido pide revisión", catItem(`${TAG} Actual Servicios S.A.`).verdict.status === "review");
    check("Destino queda permitida", catItem(`${TAG} Destino`).verdict.status === "allowed");
    let r = await cand.call("POST", `/api/catalog/${catActual.id}/apply`);
    check("postular a empresa excluida → 403", r.status === 403, r.data.error);

    // CU-02: postular (clona) → analizar → preparar → enviar
    r = await cand.call("POST", `/api/catalog/${catDestino.id}/apply`);
    check("postular a Destino → clona a Mis postulaciones", r.status === 200 && !!r.data.vacancyId);
    const vid = r.data.vacancyId;
    s = r.data.state;
    check("catálogo marca personalVacancyId tras postular", s.catalog.find((v) => v.id === catDestino.id)?.personalVacancyId === vid);
    check("la copia aparece en Mis postulaciones con su catalogId", s.vacancies.some((v) => v.id === vid && v.catalogId === catDestino.id));
    check("postular dos veces es idempotente", (await cand.call("POST", `/api/catalog/${catDestino.id}/apply`)).data.vacancyId === vid);

    const a = (await cand.call("POST", `/api/vacancies/${vid}/analyze`)).data.analysis;
    check("análisis por embeddings (3 perfiles)", a?.ranked?.length === 3, `${a?.stats?.computed} vectorizados`);
    check("recomendado = Analista de datos", a.ranked[0].profileName === "Analista de datos", `${a.ranked[0].covered}/${a.ranked[0].total}`);

    const app = (await cand.call("POST", "/api/applications", { vacancyId: vid })).data.application;
    check("borrador creado (nada enviado)", app?.status === "borrador");
    const edited = app.content.replace("Me interesa cualquier puesto disponible en su empresa.", "Me interesa el puesto porque construyo tableros de ventas y lo aplico aquí.");
    r = await cand.call("PUT", `/api/applications/${app.id}`, { content: edited });
    check("guardar editada → preparada, sin frases genéricas", r.data.application.status === "preparada" && r.data.generic.length === 0);
    r = await cand.call("POST", `/api/applications/${app.id}/send`, { approved: true });
    check("aprobar y simular envío → enviada", r.data.application?.status === "enviada");

    // CU-03: evidencia + estado honesto
    s = (await cand.call("GET", "/api/state")).data;
    check("CU-03 enviada ≠ recepción confirmada", s.applications[0].status === "enviada");
    r = await cand.call("POST", `/api/applications/${app.id}/evidence`, { type: "correo_confirmacion", reference: "Asunto: Recibimos tu postulación" });
    check("recepción confirmada con evidencia", r.data.application?.status === "recepcion_confirmada");

    // El admin ve la postulación enviada en sus contadores
    const adm = (await admin.call("GET", "/api/state")).data.adminCatalog.find((v) => v.id === catDestino.id);
    check("admin ve 1 postulación enviada en Destino", adm.stats.enviadas === 1, JSON.stringify(adm.stats));
  }

  // ---------- Seguridad: candidato no puede actuar como admin ----------
  check("candidato NO puede publicar en el catálogo → 403", (await cand.call("POST", "/api/catalog", { company: "X", title: "Y", requirements: DATA_REQS })).status === 403);
  check("candidato NO puede resembrar el catálogo → 403", (await cand.call("POST", "/api/catalog/seed")).status === 403);
  check("sin token → 401", (await fetch(API + "/api/state")).status === 401);
  const forged = await fetch(API + "/api/state", { headers: { Authorization: "Bearer x.eyJzdWIiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDEifQ.y" } });
  check("token falsificado → 401", forged.status === 401);

  // ---------- Calibración (Tabla 11), independiente del rol ----------
  for (const m of ["embed-v4.0", "embed-multilingual-v3.0", "embed-multilingual-light-v3.0"]) {
    const r = await cand.call("POST", "/api/calibration/run", { model: m });
    check(`calibración ${m}`, r.status === 200, `dim=${r.data.dim} ${r.data.msPerText}ms/texto τ=${r.data.all?.tau} F1=${r.data.all?.f1} (A: τ=${r.data.setA?.tau} F1=${r.data.setA?.f1})`);
  }

  // limpieza del candidato
  const del = await cand.call("DELETE", "/api/me");
  s = (await cand.call("GET", "/api/state")).data;
  check("borrar mis datos deja todo vacío", !s.profiles.length && !s.vacancies.length && !s.applications.length && !s.exclusions.length, `${del.data.deleted} registros`);
} finally {
  // limpieza del admin: borra solo las vacantes de este test (deja intacto el catálogo real)
  if (admin) {
    for (const c of [catDestino, catActual, catReview, catClosed]) {
      if (c) await admin.call("DELETE", `/api/catalog/${c.id}`);
    }
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
