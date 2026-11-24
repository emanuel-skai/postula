import { useState } from "react";
import { api, type AppState, type CatalogVacancy } from "../api";
import { go, useData } from "../App";
import { StatusPill, VerdictTag } from "./ui";

export function Catalog() {
  const { state } = useData();
  const cat = state!.catalog;
  const noProfiles = !state!.profiles.length;
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h1>Vacantes</h1>
          <p className="muted">Vacantes publicadas por las empresas. Toca una para ver sus requisitos e iniciar tu postulación; ya ves si la empresa está en tu lista de exclusión.</p>
        </div>
        {state!.isAdmin && <a className="btn ghost" href="#/admin">Publicar vacantes →</a>}
      </div>

      {noProfiles && (
        <div className="seed-banner card">
          <div>
            <b>¿Primera vez? Carga el escenario de ejemplo</b>
            <span className="muted">Crea el perfil ficticio de «Ana Solano» con tres versiones de CV para probar el flujo completo.</span>
          </div>
          <SeedButton />
        </div>
      )}

      {!cat.length && (
        <div className="card center muted">
          Todavía no hay vacantes publicadas.
          {state!.isAdmin
            ? <> Publícalas desde <a href="#/admin">la vista de reclutador</a>.</>
            : <> Vuelve más tarde.</>}
        </div>
      )}

      <ul className="list">
        {cat.map((c) => <CatalogRow key={c.id} c={c} />)}
      </ul>
    </section>
  );
}

// Botón prominente para cargar los datos de ejemplo (hallazgo P1/P2: no lo encontraban).
function SeedButton() {
  const { run, setState, busy } = useData();
  const load = () => run(async () => {
    setState(await api<AppState>("/api/seed", { method: "POST" }));
    go("#/perfiles");
  });
  return <button className="btn primary" disabled={busy} onClick={load}>{busy ? "Cargando…" : "Cargar datos de ejemplo"}</button>;
}

function CatalogRow({ c }: { c: CatalogVacancy }) {
  const { run, setState, busy } = useData();
  const [open, setOpen] = useState(false);
  const blocked = c.verdict.status === "blocked";
  const review = c.verdict.status === "review";
  const reqLines = c.requirements.split("\n").map((s) => s.trim()).filter(Boolean);

  const postular = () =>
    run(async () => {
      const r = await api<{ vacancyId: string; state: AppState }>(`/api/catalog/${c.id}/apply`, { method: "POST" });
      setState(r.state);
      go(`#/vacante/${r.vacancyId}`);
    });

  // Ya existe una copia personal → la tarjeta entera lleva a ella (ver análisis / seguir el estado).
  if (c.personalVacancyId) {
    return (
      <li>
        <a className={`card vac-card ${c.verdict.status}`} href={`#/vacante/${c.personalVacancyId}`}>
          <div className="vac-main">
            <span className="company">{c.company}</span>
            <span className="title">{c.title}</span>
            <span className="meta">{c.channel}</span>
          </div>
          <div className="vac-side">
            <VerdictTag verdict={c.verdict} />
            {c.applicationStatus ? <StatusPill status={c.applicationStatus} /> : <span className="pill neutral">En mis postulaciones</span>}
            <span className="chev" aria-hidden>›</span>
          </div>
        </a>
      </li>
    );
  }

  // Tarjeta expandible: tocarla abre los requisitos (P5 intentaba abrir la vacante tocando la tarjeta).
  return (
    <li>
      <div className={`card vac-card expandable ${c.verdict.status} ${open ? "open" : ""}`}>
        <button className="vac-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <div className="vac-main">
            <span className="company">{c.company}</span>
            <span className="title">{c.title}</span>
            <span className="meta">{c.channel}</span>
          </div>
          <div className="vac-side">
            <VerdictTag verdict={c.verdict} />
            <span className={`chev ${open ? "down" : ""}`} aria-hidden>›</span>
          </div>
        </button>

        {open && (
          <div className="vac-detail">
            {blocked && (
              <div className="alert danger" role="alert">
                <b>Esta empresa está en tu lista de exclusión.</b>
                <span>Coincide con «{(c.verdict as any).exclusion}». No puedes iniciar una postulación hacia ella desde Postula. Si fue un error, quítala en <a href="#/exclusiones">Exclusiones</a>.</span>
              </div>
            )}
            {review && (
              <div className="alert warn" role="alert">
                <b>Nombre parecido a una empresa que excluiste.</b>
                <span>«{c.company}» se parece a «{(c.verdict as any).exclusion}». Revísalo: al iniciar la postulación podrás confirmar si es o no la misma empresa.</span>
              </div>
            )}
            <h3>Requisitos</h3>
            <ul className="req-list">{reqLines.map((r, i) => <li key={i}>{r}</li>)}</ul>
            <div className="row end">
              {blocked
                ? <button className="btn" disabled title="Esta empresa está en tu lista de exclusión">No disponible (empresa excluida)</button>
                : <button className="btn primary" disabled={busy} onClick={postular}>Iniciar postulación</button>}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
