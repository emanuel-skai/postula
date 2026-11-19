import type { AppStatus, Verdict } from "../api";

export const STATUS_LABEL: Record<AppStatus, string> = {
  borrador: "Borrador",
  preparada: "Preparada",
  enviada: "Enviada",
  recepcion_confirmada: "Recepción confirmada",
};

export function StatusPill({ status }: { status: AppStatus }) {
  return (
    <span className={`pill st-${status}`}>
      {STATUS_LABEL[status]}
      {status === "enviada" && <span className="pill-sub"> · recepción no confirmada</span>}
    </span>
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
