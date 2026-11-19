import { api, type AppState, type CatalogVacancy } from "../api";
import { go, useData } from "../App";
import { StatusPill, VerdictTag } from "./ui";

export function Catalog() {
  const { state } = useData();
  const cat = state!.catalog;
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h1>Vacantes</h1>
          <p className="muted">Vacantes publicadas por las empresas. Postúlate a la que te interese; ya ves si la empresa está en tu lista de exclusión.</p>
        </div>
        {state!.isAdmin && <a className="btn ghost" href="#/admin">Publicar vacantes →</a>}
      </div>

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

function CatalogRow({ c }: { c: CatalogVacancy }) {
  const { run, setState, busy } = useData();
  const blocked = c.verdict.status === "blocked";

  const postular = () =>
    run(async () => {
      const r = await api<{ vacancyId: string; state: AppState }>(`/api/catalog/${c.id}/apply`, { method: "POST" });
      setState(r.state);
      go(`#/vacante/${r.vacancyId}`);
    });

  // Ya existe una copia personal → ir a ella (ver análisis / seguir el estado).
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

  return (
    <li>
      <div className={`card vac-card ${c.verdict.status}`}>
        <div className="vac-main">
          <span className="company">{c.company}</span>
          <span className="title">{c.title}</span>
          <span className="meta">{c.channel}</span>
        </div>
        <div className="vac-side">
          <VerdictTag verdict={c.verdict} />
          {blocked
            ? <button className="btn sm" disabled title="Esta empresa está en tu lista de exclusión">Excluida</button>
            : <button className="btn primary sm" disabled={busy} onClick={postular}>Postular</button>}
        </div>
      </div>
    </li>
  );
}
