import { useState } from "react";
import { api, type AdminVacancy, type AppState } from "../api";
import { useData } from "../App";
import { fmtDate } from "./ui";

export function Admin() {
  const { state, run, setState, busy, toast } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (!state!.isAdmin) {
    return <div className="card center">Esta vista es solo para el reclutador. <a href="#/catalogo">Ver vacantes</a></div>;
  }

  const list = state!.adminCatalog ?? [];
  const seed = () =>
    run(async () => {
      setState(await api<AppState>("/api/catalog/seed", { method: "POST" }));
      toast("Vacantes de ejemplo publicadas");
    });

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <p className="eyebrow accent">Vista de reclutador</p>
          <h1>Publicar vacantes</h1>
          <p className="muted">Publica las vacantes a las que los candidatos podrán postularse. Aquí ves cuántas postulaciones ha recibido cada una.</p>
        </div>
        <div className="row gap">
          {!list.length && <button className="btn ghost" disabled={busy} onClick={seed}>Cargar 4 de ejemplo</button>}
          <button className="btn" onClick={() => { setAdding(!adding); setEditing(null); }}>{adding ? "Cancelar" : "+ Nueva vacante"}</button>
        </div>
      </div>

      {adding && <VacancyForm onDone={() => setAdding(false)} />}

      {!list.length && !adding && (
        <div className="card center muted">Aún no has publicado vacantes. Crea una o carga las de ejemplo.</div>
      )}

      <ul className="list">
        {list.map((v) =>
          editing === v.id ? (
            <li key={v.id}><VacancyForm vac={v} onDone={() => setEditing(null)} /></li>
          ) : (
            <li key={v.id}>
              <AdminRow v={v} onEdit={() => { setEditing(v.id); setAdding(false); }} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function AdminRow({ v, onEdit }: { v: AdminVacancy; onEdit: () => void }) {
  const { run, setState, busy } = useData();
  const [confirmDel, setConfirmDel] = useState(false);
  const closed = v.status === "closed";

  const setStatus = (status: "open" | "closed") =>
    run(async () => setState(await api<AppState>(`/api/catalog/${v.id}/status`, { method: "POST", body: { status } })));
  const remove = () =>
    run(async () => setState(await api<AppState>(`/api/catalog/${v.id}`, { method: "DELETE" })));

  return (
    <div className={`card admin-vac ${closed ? "closed" : ""}`}>
      <div className="row between wrap">
        <div className="vac-main">
          <span className="company">{v.company} {closed && <span className="pill neutral sm">Cerrada</span>}</span>
          <span className="title">{v.title}</span>
          <span className="meta">{v.channel} · publicada {fmtDate(v.publishedAt)}</span>
        </div>
        <div className="admin-stats" aria-label="Postulaciones recibidas">
          <span><b>{v.stats.enviadas}</b> enviadas</span>
          <span className="muted small"><b>{v.stats.enProceso}</b> en proceso</span>
        </div>
      </div>
      <div className="row gap wrap end">
        <button className="btn ghost sm" disabled={busy} onClick={onEdit}>Editar</button>
        {closed
          ? <button className="btn ghost sm" disabled={busy} onClick={() => setStatus("open")}>Reabrir</button>
          : <button className="btn ghost sm" disabled={busy} onClick={() => setStatus("closed")}>Cerrar</button>}
        {!confirmDel
          ? <button className="btn ghost sm" onClick={() => setConfirmDel(true)}>Eliminar</button>
          : <span className="row gap"><span className="muted small">¿Eliminar?</span><button className="btn danger sm" disabled={busy} onClick={remove}>Sí</button><button className="btn ghost sm" onClick={() => setConfirmDel(false)}>No</button></span>}
      </div>
    </div>
  );
}

function VacancyForm({ vac, onDone }: { vac?: AdminVacancy; onDone: () => void }) {
  const { run, setState, busy, toast } = useData();
  const [f, setF] = useState({
    company: vac?.company ?? "",
    title: vac?.title ?? "",
    channel: vac?.channel ?? "",
    requirements: vac?.requirements ?? "",
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      const path = vac ? `/api/catalog/${vac.id}` : "/api/catalog";
      setState(await api<AppState>(path, { method: vac ? "PUT" : "POST", body: f }));
      return true;
    });
    if (ok) { toast(vac ? "Vacante actualizada" : "Vacante publicada"); onDone(); }
  };
  return (
    <form className="card form" onSubmit={submit}>
      <div className="grid2">
        <label>Empresa<input required value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Ej. Empresa Destino" /></label>
        <label>Puesto<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej. Analista de Datos" /></label>
      </div>
      <label>Canal / fuente <span className="opt">(opcional)</span>
        <input value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} placeholder="Ej. LinkedIn, sitio de la empresa" />
      </label>
      <label>Requisitos <span className="opt">una línea por requisito, mínimo 4 palabras</span>
        <textarea required rows={6} value={f.requirements} onChange={(e) => setF({ ...f, requirements: e.target.value })}
          placeholder={"Experiencia construyendo dashboards de negocio\nManejo avanzado de SQL en bases relacionales"} />
      </label>
      <div className="row end gap">
        <button type="button" className="btn ghost" onClick={onDone}>Cancelar</button>
        <button className="btn primary" disabled={busy}>{vac ? "Guardar cambios" : "Publicar vacante"}</button>
      </div>
    </form>
  );
}
