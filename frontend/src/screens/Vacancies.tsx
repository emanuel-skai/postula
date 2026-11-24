import { useState } from "react";
import { api, type Analysis, type AppState, type Application, type Vacancy } from "../api";
import { go, useData } from "../App";
import { Back, Coverage, StatusPill, VerdictTag } from "./ui";

export function Vacancies() {
  const { state } = useData();
  const vacs = state!.vacancies;
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h1>Mis postulaciones</h1>
          <p className="muted">Las vacantes a las que te postulaste. Aquí las analizas con tu CV, preparas la carta y sigues el estado.</p>
        </div>
        <a className="btn" href="#/catalogo">Ver vacantes</a>
      </div>
      {!vacs.length && (
        <div className="card center muted">
          Todavía no te has postulado a ninguna vacante. Explora el <a href="#/catalogo">catálogo de vacantes</a> y pulsa «Postular».
        </div>
      )}
      <ul className="list">
        {vacs.map((v) => (
          <li key={v.id}>
            <a className={`card vac-card ${v.verdict.status}`} href={`#/vacante/${v.id}`}>
              <div className="vac-main">
                <span className="company">{v.company}</span>
                <span className="title">{v.title}</span>
                <span className="meta">{v.channel}</span>
              </div>
              <div className="vac-side">
                <VerdictTag verdict={v.verdict} />
                {v.applicationStatus && <StatusPill status={v.applicationStatus} />}
                {v.analysis && !v.applicationStatus && v.verdict.status !== "blocked" && (
                  <span className="pill neutral">
                    {v.analysis.ranked[0]?.covered ?? 0} de {v.analysis.ranked[0]?.total ?? 0} cubiertos
                  </span>
                )}
                {!v.analysis && !v.applicationStatus && v.verdict.status === "allowed" && (
                  <span className="pill neutral">Por analizar</span>
                )}
                <span className="chev" aria-hidden>›</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function VacancyDetail({ id }: { id: string }) {
  const { state, run, setState, busy, toast } = useData();
  const v = state!.vacancies.find((x) => x.id === id);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!v) return <div className="card center">Vacante no encontrada. <a href="#/postulaciones">Volver</a></div>;

  const analyze = async () => {
    setAnalyzing(true);
    await run(async () => {
      const r = await api<{ analysis: Analysis; state: AppState }>(`/api/vacancies/${v.id}/analyze`, { method: "POST" });
      setState(r.state);
    });
    setAnalyzing(false);
  };
  const ack = () => run(async () => setState(await api(`/api/vacancies/${v.id}/acknowledge`, { method: "POST", body: { exclusion: (v.verdict as any).exclusion } })));
  const excludeToo = () => run(async () => {
    setState(await api("/api/exclusions", { method: "POST", body: { name: v.company } }));
    toast(`«${v.company}» agregada a tus exclusiones`);
  });
  const prepare = (profileId?: string) => run(async () => {
    const r = await api<{ application: Application; state: AppState }>("/api/applications", { method: "POST", body: { vacancyId: v.id, profileId } });
    setState(r.state);
    go(`#/postulacion/${r.application.id}`);
  });
  const remove = () => run(async () => { setState(await api(`/api/vacancies/${v.id}`, { method: "DELETE" })); go("#/vacantes"); });

  const blocked = v.verdict.status === "blocked";
  const review = v.verdict.status === "review";
  // La solicitud ya partió (envío simulado): el análisis queda congelado.
  const sent = v.applicationStatus === "enviada" || v.applicationStatus === "recepcion_confirmada";
  // Se puede (re)analizar mientras no se haya enviado: sin solicitud, o en borrador/preparada.
  const canReanalyze = !sent;
  const reqLines = v.requirements.split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <section className="stack">
      <Back href="#/postulaciones" label="Mis postulaciones" />
      <div className="card">
        <div className="row between wrap">
          <div>
            <span className="company big">{v.company}</span>
            <h1 className="title-lg">{v.title}</h1>
            <span className="meta">{v.channel}</span>
          </div>
          <VerdictTag verdict={v.verdict} />
        </div>

        {blocked && (
          <div className="alert danger" role="alert">
            <b>Esta empresa está en tu lista de exclusión. No puedes enviar esta postulación.</b>
            <span>Coincide con «{(v.verdict as any).exclusion}». Si fue un error, quítala en <a href="#/exclusiones">Exclusiones</a>.</span>
          </div>
        )}
        {review && (
          <div className="alert warn" role="alert">
            <b>Revisar nombre: {(v.verdict as any).reason}</b>
            <span>«{v.company}» se parece a «{(v.verdict as any).exclusion}», que excluiste. Decide antes de continuar.</span>
            <div className="row gap wrap">
              <button className="btn danger sm" disabled={busy} onClick={excludeToo}>Excluir también esta empresa</button>
              <button className="btn ghost sm" disabled={busy} onClick={ack}>No es la misma empresa, continuar</button>
            </div>
          </div>
        )}

        <h3>Requisitos</h3>
        <ul className="req-list">{reqLines.map((r, i) => <li key={i}>{r}</li>)}</ul>

        {/* P4: mientras la solicitud sigue en borrador/preparada (no enviada) se puede recalcular el análisis. */}
        {!blocked && !review && (
          <div className="row gap wrap">
            {canReanalyze && (
              <button className="btn primary" onClick={analyze} disabled={busy || !state!.profiles.length}>
                {analyzing ? "Analizando con embeddings…" : v.analysis ? (v.analysisStale ? "Recalcular análisis" : "Volver a analizar") : "Analizar"}
              </button>
            )}
            {v.applicationId && <a className={`btn ${canReanalyze ? "ghost" : "primary"}`} href={`#/postulacion/${v.applicationId}`}>Ver mi postulación</a>}
            {sent && <span className="muted small">La solicitud ya se envió; el análisis queda fijo como registro de lo que la respaldó.</span>}
            {!state!.profiles.length && <span className="muted">Agrega un perfil en <a href="#/perfiles">Mis perfiles</a> para analizar.</span>}
          </div>
        )}
        {blocked && <button className="btn" disabled>Preparar postulación</button>}
      </div>

      {v.analysis && !blocked && !review && (
        <AnalysisView v={v} a={v.analysis} onPrepare={prepare} busy={busy} canReanalyze={canReanalyze} analyzing={analyzing} onReanalyze={analyze} profiles={state!.profiles.length} />
      )}

      <div className="row end">
        {!confirmDelete
          ? <button className="btn ghost sm" onClick={() => setConfirmDelete(true)}>Quitar de mis postulaciones</button>
          : <span className="row gap"><span className="muted">¿Quitar esta postulación? (no se habrá enviado nada)</span><button className="btn danger sm" onClick={remove}>Sí, eliminar</button><button className="btn ghost sm" onClick={() => setConfirmDelete(false)}>No</button></span>}
      </div>
    </section>
  );
}

function AnalysisView({ v, a, onPrepare, busy, canReanalyze, analyzing, onReanalyze, profiles }: {
  v: Vacancy; a: Analysis; onPrepare: (pid?: string) => void; busy: boolean;
  canReanalyze: boolean; analyzing: boolean; onReanalyze: () => void; profiles: number;
}) {
  const [open, setOpen] = useState<string | null>(a.recommendedProfileId);
  const rec = a.ranked.find((p) => p.profileId === a.recommendedProfileId) ?? a.ranked[0];
  return (
    <div className="stack">
      {v.analysisStale && (
        <div className="alert warn" role="alert">
          <b>Análisis desactualizado</b>
          <span>Tus perfiles cambiaron desde este análisis: lo que ves abajo ya no corresponde a tu CV actual.</span>
          {canReanalyze
            ? <div className="row gap wrap"><button className="btn primary sm" onClick={onReanalyze} disabled={busy || !profiles}>{analyzing ? "Recalculando…" : "Recalcular análisis"}</button></div>
            : <span className="muted small">La solicitud ya se envió; este análisis queda como registro.</span>}
        </div>
      )}
      {rec && (
        <div className="card recommended">
          <p className="eyebrow accent">Perfil recomendado</p>
          <div className="row between wrap">
            <h2>{rec.profileName}</h2>
            <Coverage covered={rec.covered} total={rec.total} />
          </div>
          <p className="muted small">
            {a.tieBrokenByMean ? "Empate en requisitos cubiertos; se eligió por mayor similitud promedio. " : ""}
            Basado en la línea de tu CV más parecida a cada requisito. No es un puntaje de compatibilidad.
          </p>
          {!v.applicationId && (
            <button className="btn primary" disabled={busy} onClick={() => onPrepare(rec.profileId)}>Preparar postulación con este perfil</button>
          )}
        </div>
      )}
      <div className="card">
        <h3>Comparación por perfil</h3>
        <ul className="profile-results">
          {a.ranked.map((p) => (
            <li key={p.profileId} className={open === p.profileId ? "open" : ""}>
              <button className="pr-head" onClick={() => setOpen(open === p.profileId ? null : p.profileId)} aria-expanded={open === p.profileId}>
                <span className="pr-name">{p.profileName}{p.profileId === rec?.profileId && <span className="pill accent sm">Recomendado</span>}</span>
                <Coverage covered={p.covered} total={p.total} />
              </button>
              {open === p.profileId && (
                <div className="pr-body">
                  <ul className="evidence">
                    {p.requirements.map((r, i) => (
                      <li key={i} className={r.covered ? "ok" : "no"}>
                        <span className="mark" aria-hidden>{r.covered ? "✓" : "—"}</span>
                        <div>
                          <span className="req">{r.requirement}</span>
                          {r.covered
                            ? <span className="ev">Evidencia: «{r.evidence}»</span>
                            : (
                              <>
                                <span className="ev none">Sin cubrir: no encontramos una línea de tu CV que signifique lo mismo.</span>
                                {r.closest && <span className="ev closest">Lo más parecido (habilidad relacionada pero distinta): «{r.closest}». Revísalo tú: tener algo parecido no demuestra que cumplas el requisito.</span>}
                              </>
                            )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {p.covered < p.total && (
                    <p className="note review-note">
                      Una coincidencia de <b>significado</b> no prueba por sí sola que cumplas la habilidad (por ejemplo, el dominio de un idioma). Toma estos resultados como una guía que <b>requiere tu revisión</b>, no como una verificación.
                    </p>
                  )}
                  {!v.applicationId && p.profileId !== rec?.profileId && (
                    <button className="btn ghost sm" disabled={busy} onClick={() => onPrepare(p.profileId)}>Usar este perfil</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="tech">
          Motor: Cohere {a.model} · τ = {a.tau} · {a.requirements.length} requisitos · {a.stats.computed} textos vectorizados, {a.stats.cached} desde caché · {(a.ms / 1000).toFixed(1)} s
        </p>
      </div>
    </div>
  );
}
