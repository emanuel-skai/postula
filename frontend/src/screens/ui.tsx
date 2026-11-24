import type { AppStatus, Verdict } from "../api";

export const STATUS_LABEL: Record<AppStatus, string> = {
  borrador: "Borrador",
  preparada: "Preparada",
  enviada: "Enviada",
  recepcion_confirmada: "Recepción confirmada",
};

// Qué significa cada estado (CU3). Se usa en el tooltip de la insignia y en la leyenda.
export const STATUS_DESC: Record<AppStatus, string> = {
  borrador: "Borrador en construcción. Nada se ha enviado: puedes editar el texto y recalcular el análisis.",
  preparada: "Lista para aprobar. Aún NO se ha enviado; falta tu autorización.",
  enviada: "Envío simulado hecho. «Enviada» NO significa que la empresa la haya recibido o leído.",
  recepcion_confirmada: "Registraste una evidencia (correo, acuse o contacto) de que la empresa sí la recibió.",
};

export function StatusPill({ status }: { status: AppStatus }) {
  return (
    <span className={`pill st-${status}`} title={STATUS_DESC[status]}>
      <span className="st-dot" aria-hidden />
      {STATUS_LABEL[status]}
      {status === "enviada" && <span className="pill-sub"> · recepción no confirmada</span>}
    </span>
  );
}

// Leyenda plegable que explica los cuatro estados y, sobre todo, distingue
// preparada↔enviada y enviada↔recepción confirmada (hallazgos P2/P4).
export function StatusLegend() {
  const order: AppStatus[] = ["borrador", "preparada", "enviada", "recepcion_confirmada"];
  return (
    <details className="status-legend">
      <summary>¿Qué significa cada estado?</summary>
      <dl>
        {order.map((s) => (
          <div key={s}>
            <dt><StatusPill status={s} /></dt>
            <dd>{STATUS_DESC[s]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function VerdictTag({ verdict }: { verdict: Verdict }) {
  if (verdict.status === "blocked") return <span className="pill danger">Excluida</span>;
  if (verdict.status === "review") return <span className="pill warn">Revisar nombre</span>;
  return null;
}

export function Back({ href, label }: { href: string; label: string }) {
  return <a className="back" href={href}>← {label}</a>;
}

export function Stepper({ step }: { step: 0 | 1 | 2 }) {
  const steps = ["Revisar", "Aprobar", "Estado"];
  return (
    <ol className="stepper" aria-label="Pasos de la postulación">
      {steps.map((s, i) => (
        <li key={s} className={i < step ? "done" : i === step ? "current" : ""} aria-current={i === step ? "step" : undefined}>
          <span className="num">{i < step ? "✓" : i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

export function Coverage({ covered, total }: { covered: number; total: number }) {
  return (
    <span className="coverage">
      <span className="segs" aria-hidden>
        {Array.from({ length: total }, (_, i) => <i key={i} className={i < covered ? "on" : ""} />)}
      </span>
      <b>{covered} de {total}</b> requisitos cubiertos
    </span>
  );
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
