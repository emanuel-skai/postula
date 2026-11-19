import { useState } from "react";
import { api, type AppState } from "../api";
import { useData } from "../App";

export function Exclusions() {
  const { state, run, setState, busy, toast } = useData();
  const [name, setName] = useState("");
  const list = state!.exclusions;
  const affected = (exName: string) =>
    state!.vacancies.filter((v) => v.verdict.status !== "allowed" && (v.verdict as any).exclusion === exName);
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      setState(await api<AppState>("/api/exclusions", { method: "POST", body: { name } }));
      toast(`«${name.trim()}» agregada. No podrás enviarle postulaciones desde Postula.`);
      setName("");
    });
  };
  const remove = (id: string, n: string) => run(async () => {
    setState(await api<AppState>(`/api/exclusions/${id}`, { method: "DELETE" }));
    toast(`«${n}» quitada de tus exclusiones`);
  });
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h1>Empresas excluidas</h1>
          <p className="muted">Añade las empresas a las que no quieres enviar postulaciones.</p>
        </div>
      </div>
      <form className="card form row-form" onSubmit={add}>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Empresa Actual" aria-label="Nombre de la empresa" />
        <button className="btn primary" disabled={busy || !name.trim()}>Añadir</button>
      </form>
      <div className="note">
        <b>Qué cubre:</b> la exclusión bloquea postulaciones desde esta herramienta. Reconoce el mismo nombre aunque cambien
        mayúsculas, tildes, puntuación o sufijos como S.A., S.R.L. o Ltda., y te avisa de nombres parecidos.
        <br /><b>Qué no cubre:</b> no oculta tu perfil en otros portales y no detecta filiales ni razones sociales distintas por sí sola.
      </div>
      {!list.length && <div className="card center muted">Tu lista está vacía.</div>}
      <ul className="list">
        {list.map((e) => {
          const hits = affected(e.name);
          return (
            <li key={e.id} className="card excl-row">
              <div>
                <b>{e.name}</b>
                <span className="meta">
                  {hits.length ? `Afecta ${hits.length} vacante${hits.length > 1 ? "s" : ""}: ${hits.map((h) => h.company).join(", ")}` : "Ninguna vacante coincide por ahora"}
                </span>
              </div>
              <button className="btn ghost sm" disabled={busy} onClick={() => remove(e.id, e.name)}>Quitar</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
