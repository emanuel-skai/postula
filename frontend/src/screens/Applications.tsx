import { useEffect, useMemo, useState } from "react";
import { api, findGeneric, type AppState, type Application, type AppStatus } from "../api";
import { go, useData } from "../App";
import { Back, Coverage, StatusPill, Stepper, fmtDate } from "./ui";

export function Applications() {
  const { state } = useData();
  const apps = state!.applications;
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h1>Mis solicitudes</h1>
          <p className="muted">«Enviada» no significa que la empresa la recibió o la leyó.</p>
        </div>
      </div>
      {!apps.length && <div className="card center muted">Aún no preparas ninguna postulación. Empieza desde <a href="#/vacantes">Vacantes</a>.</div>}
      <ul className="list">
        {apps.map((a) => (
          <li key={a.id}>
            <a className="card vac-card" href={`#/postulacion/${a.id}`}>
              <div className="vac-main">
                <span className="company">{a.company}</span>
                <span className="title">{a.title}</span>
                <span className="meta">Actualizada {fmtDate(a.updatedAt)}{a.profileName ? ` · perfil ${a.profileName}` : ""}</span>
              </div>
              <div className="vac-side"><StatusPill status={a.status} /><span className="chev" aria-hidden>›</span></div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ApplicationFlow({ id, step }: { id: string; step: string | null }) {
  const { state } = useData();
  const a = state!.applications.find((x) => x.id === id);
  if (!a) return <div className="card center">Solicitud no encontrada. <a href="#/solicitudes">Volver</a></div>;
  const sent = a.status === "enviada" || a.status === "recepcion_confirmada";
  if (sent) return <StatusView a={a} />;
  if (step === "aprobar" && a.status === "preparada") return <ApproveView a={a} />;
  return <ReviewView a={a} />;
}

function ReviewView({ a }: { a: Application }) {
  const { run, setState, busy } = useData();
  const [text, setText] = useState(a.content);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => setText(a.content), [a.id]);
  const generic = useMemo(() => findGeneric(text), [text]);
  const save = () => run(async () => {
    const r = await api<{ application: Application; state: AppState }>(`/api/applications/${a.id}`, { method: "PUT", body: { content: text } });
    setState(r.state);
    go(`#/postulacion/${a.id}?paso=aprobar`);
  });
  const discard = () => run(async () => { setState(await api(`/api/applications/${a.id}`, { method: "DELETE" })); go(`#/vacante/${a.vacancyId}`); });

  return (
    <section className="stack">
      <Back href={`#/vacante/${a.vacancyId}`} label="Vacante" />
      <Stepper step={0} />
      <div className="card">
        <h1 className="title-lg">Revisa la empresa y el contenido antes de continuar</h1>
        <Recipient a={a} />
        {a.coverage && <p className="muted small">Borrador armado con tu perfil «{a.profileName}» · <Coverage {...a.coverage} /></p>}
        {generic.length > 0 && (
          <div className="alert warn" role="alert">
            <b>Frase genérica detectada</b>
            <span>Reemplázala por un motivo concreto para esta vacante:</span>
            <ul>{generic.map((g, i) => <li key={i}>«{g}»</li>)}</ul>
          </div>
        )}
        <label className="block">Contenido de la postulación
          <textarea className="tall" value={text} onChange={(e) => setText(e.target.value)} rows={16} />
        </label>
        <p className="nothing-sent"><span className="dot" /> Nada se ha enviado todavía.</p>
        <div className="row between wrap gap">
          {!confirmDiscard
            ? <button className="btn ghost sm" onClick={() => setConfirmDiscard(true)}>Descartar borrador</button>
            : <span className="row gap"><button className="btn danger sm" onClick={discard}>Sí, descartar</button><button className="btn ghost sm" onClick={() => setConfirmDiscard(false)}>No</button></span>}
          <button className="btn primary" onClick={save} disabled={busy || !text.trim()}>Guardar y pasar a aprobación</button>
        </div>
      </div>
    </section>
  );
}

function Recipient({ a, strong }: { a: Application; strong?: boolean }) {
  return (
    <div className={`recipient ${strong ? "strong" : ""}`}>
      <span className="label">Se enviará a</span>
      <span className="to">{a.company}</span>
      <span className="sub">{a.title} · {a.channel}</span>
    </div>
  );
}

function ApproveView({ a }: { a: Application }) {
  const { run, setState, busy } = useData();
  const [ok, setOk] = useState(false);
  const generic = findGeneric(a.content);
  const send = () => run(async () => {
    const r = await api<{ application: Application; state: AppState }>(`/api/applications/${a.id}/send`, { method: "POST", body: { approved: ok } });
    setState(r.state);
    go(`#/postulacion/${a.id}`);
  });
  return (
    <section className="stack">
      <Back href={`#/postulacion/${a.id}`} label="Volver a editar" />
      <Stepper step={1} />
      <div className="card">
        <h1 className="title-lg">Confirma lo que se enviará</h1>
        <Recipient a={a} strong />
        <div className="content-preview">
          <div className="row between"><span className="label">Contenido completo</span>{a.edited ? <span className="pill accent sm">Editado por ti</span> : <span className="pill warn sm">Sin editar</span>}</div>
          <pre>{a.content}</pre>
        </div>
        {generic.length > 0 && <div className="alert warn"><b>Aún contiene una frase genérica.</b><span>Puedes volver a editar antes de aprobar.</span></div>}
        <label className="check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>Revisé el destinatario y el contenido. Autorizo este envío.</span>
        </label>
        <div className="row between wrap gap">
          <a className="btn ghost" href={`#/postulacion/${a.id}`}>Volver a editar</a>
          <button className="btn primary" disabled={!ok || busy} onClick={send}>Aprobar y simular envío</button>
        </div>
      </div>
    </section>
  );
}

const EVIDENCE_TYPES = [
  ["correo_confirmacion", "Correo de confirmación de la empresa"],
  ["acuse_portal", "Acuse de recibo en el portal"],
  ["contacto_reclutador", "Contacto del reclutador"],
] as const;

function StatusView({ a }: { a: Application }) {
  const { run, setState, busy, toast } = useData();
  const [showEv, setShowEv] = useState(false);
  const [ev, setEv] = useState({ type: "correo_confirmacion", reference: "" });
  const confirmed = a.status === "recepcion_confirmada";
  const order: AppStatus[] = ["preparada", "enviada", "recepcion_confirmada"];
  const reached = (s: AppStatus) => a.timeline.some((t) => t.status === s);
  const at = (s: AppStatus) => a.timeline.find((t) => t.status === s)?.at;
  const submitEv = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ state: AppState }>(`/api/applications/${a.id}/evidence`, { method: "POST", body: ev });
      setState(r.state);
      toast("Recepción confirmada con tu evidencia");
      setShowEv(false);
    });
  };
  return (
    <section className="stack">
      <Back href="#/solicitudes" label="Mis solicitudes" />
      <Stepper step={2} />
      <div className="card">
        <span className="company big">{a.company}</span>
        <h1 className="title-lg">{a.title}</h1>
        <div className={`status-hero ${confirmed ? "ok" : "sent"}`}>
          {confirmed
            ? <><b>Recepción confirmada.</b><span>Registraste evidencia de que la empresa recibió la solicitud.</span></>
            : <><b>Enviada. Aún no hay confirmación de recepción.</b><span>Este estado no indica que la empresa haya recibido o leído la solicitud.</span></>}
        </div>

        <ol className="timeline">
          {order.map((s) => (
            <li key={s} className={reached(s) ? "done" : "pending"}>
              <span className="tl-dot" />
              <div>
                <b>{s === "preparada" ? "Preparada" : s === "enviada" ? "Enviada (simulado)" : "Recepción confirmada"}</b>
                <span className="muted small">
                  {reached(s) ? fmtDate(at(s)!) : s === "recepcion_confirmada" ? "Sin evidencia todavía" : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>

        {!confirmed && (
          <div className="explain">
            <h3>¿Qué cambiaría este estado?</h3>
            <p className="muted">Solo una evidencia de la empresa: un correo de confirmación, un acuse de recibo en el portal o un contacto del reclutador. Sin eso, la solicitud queda como enviada.</p>
            {!showEv
              ? <button className="btn ghost sm" onClick={() => setShowEv(true)}>Registrar evidencia de recepción</button>
              : (
                <form className="form inset" onSubmit={submitEv}>
                  <label>Tipo de evidencia
                    <select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })}>
                      {EVIDENCE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label>Referencia <span className="opt">ej. asunto del correo o número de acuse</span>
                    <input required value={ev.reference} onChange={(e) => setEv({ ...ev, reference: e.target.value })} />
                  </label>
                  <div className="row end gap"><button type="button" className="btn ghost sm" onClick={() => setShowEv(false)}>Cancelar</button><button className="btn primary sm" disabled={busy}>Confirmar recepción</button></div>
                </form>
              )}
          </div>
        )}
        {confirmed && a.evidence && (
          <p className="muted small">Evidencia: {EVIDENCE_TYPES.find(([k]) => k === a.evidence!.type)?.[1]} · «{a.evidence.reference}» · {fmtDate(a.evidence.at)}</p>
        )}

        <details className="sent-content">
          <summary>Ver contenido enviado</summary>
          <pre>{a.content}</pre>
        </details>
      </div>
    </section>
  );
}
