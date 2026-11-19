import { useEffect, useState } from "react";
import { api, type AppState } from "../api";
import { go, useData } from "../App";

interface EngineInfo {
  engine: string; model: string; tau: number; minWords: number; queryInputType: string; documentInputType: string;
  calibrationModels: string[]; ping: { ok: boolean; dim?: number; ms: number; error?: string };
}
interface Summary { pairs: number; tau: number; tauRange: [number, number]; f1: number; precision: number; recall: number }
interface CalibResult {
  model: string; dim: number; msTotal: number; msPerText: number; setA: Summary; all: Summary; at: string;
  scored: { req: string; line: string; label: boolean; set: string; score: number }[];
}

export function Engine() {
  const { run, setState, busy, toast } = useData();
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [calib, setCalib] = useState<CalibResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [showPairs, setShowPairs] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    api<EngineInfo>("/api/engine").then(setInfo).catch((e) => toast(e.message, "error"));
    api<{ results: CalibResult[] }>("/api/calibration", { auth: false }).then((r) => setCalib(r.results)).catch(() => {});
  }, [toast]);

  const calibrate = async (model: string) => {
    setRunning(model);
    await run(async () => {
      const r = await api<CalibResult>("/api/calibration/run", { method: "POST", body: { model } });
      setCalib((c) => [...c.filter((x) => x.model !== model), r]);
    });
    setRunning(null);
  };
  const reset = () => run(async () => {
    setState(await api<AppState>("/api/seed", { method: "POST" }));
    toast("Prototipo reiniciado con los datos de ejemplo");
    setConfirmReset(false);
    go("#/vacantes");
  });

  const models = info?.calibrationModels ?? ["embed-v4.0", "embed-multilingual-v3.0", "embed-multilingual-light-v3.0"];
  const sorted = models.map((m) => calib.find((c) => c.model === m)).filter(Boolean) as CalibResult[];

  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h1>Motor y configuración</h1>
          <p className="muted">Cómo se comparan tus perfiles con una vacante y con qué umbral.</p>
        </div>
      </div>

      <div className="card">
        <div className="row between wrap">
          <h3>Estado del modelo</h3>
          {info ? (info.ping.ok ? <span className="pill ok">Modelo listo</span> : <span className="pill danger">No disponible</span>) : <span className="pill neutral">Comprobando…</span>}
        </div>
        <dl className="kv">
          <dt>Proveedor</dt><dd>Cohere Embed (API)</dd>
          <dt>Modelo</dt><dd><code>{info?.model ?? "…"}</code>{info?.ping.dim ? ` · ${info.ping.dim} dimensiones` : ""}</dd>
          <dt>Umbral τ</dt><dd><code>{info?.tau ?? "…"}</code> <span className="muted small">(archivo de configuración, elegido por calibración)</span></dd>
          <dt>Latencia</dt><dd>{info ? `${info.ping.ms} ms por consulta de prueba` : "…"}</dd>
          <dt>Descarga</dt><dd>0 MB en tu dispositivo: el modelo corre en Cohere, no en el navegador.</dd>
        </dl>
        {info && !info.ping.ok && <p className="alert danger">{info.ping.error}</p>}
      </div>

      <div className="card">
        <h3>Cómo funciona</h3>
        <ol className="how">
          <li>Se separan requisitos y CV por líneas; se descartan las de menos de {info?.minWords ?? 4} palabras.</li>
          <li>Cada requisito se vectoriza como consulta (<code>{info?.queryInputType ?? "search_query"}</code>) y cada línea del CV como documento (<code>{info?.documentInputType ?? "search_document"}</code>). Es el equivalente a los prefijos <code>task: search result | query:</code> y <code>title: none | text:</code> de EmbeddingGemma.</li>
          <li><code>S = Q · Dᵀ</code> con similitud coseno.</li>
          <li>Por requisito, <code>sᵢ = maxⱼ Sᵢⱼ</code>; está cubierto si <code>sᵢ ≥ τ</code> y la línea ganadora es la evidencia.</li>
          <li>Perfil recomendado = más requisitos cubiertos; si empatan, el de mayor promedio de <code>sᵢ</code>.</li>
          <li>No se muestran porcentajes de compatibilidad: solo el conteo y la evidencia.</li>
        </ol>
        <p className="note">
          <b>Privacidad:</b> para vectorizar, las líneas de tu CV y los requisitos se envían a la API de Cohere desde el servidor de Postula.
          Los vectores se guardan en tu cuenta para no recalcularlos y se borran con «Borrar mis datos». La exclusión de empresas no usa IA.
        </p>
      </div>

      <div className="card">
        <div className="row between wrap">
          <h3>Calibración (Tabla 11)</h3>
          <span className="muted small">{sorted[0]?.all.pairs ?? 32} pares etiquetados · set A = 20 pares de la guía · A+B = con 12 casos difíciles</span>
        </div>
        <div className="table-wrap">
          <table className="calib">
            <thead>
              <tr><th>Modelo</th><th>Dim.</th><th>Tiempo</th><th>τ (A)</th><th>F1 (A)</th><th>τ (A+B)</th><th>F1 (A+B)</th><th /></tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const c = calib.find((x) => x.model === m);
                return (
                  <tr key={m} className={info?.model === m ? "current" : ""}>
                    <td><code>{m}</code>{info?.model === m && <span className="pill accent sm">en uso</span>}</td>
                    <td>{c?.dim ?? "—"}</td>
                    <td>{c ? `${c.msPerText} ms/texto` : "—"}</td>
                    <td>{c ? c.setA.tau : "—"}</td>
                    <td>{c ? c.setA.f1.toFixed(3) : "—"}</td>
                    <td>{c ? c.all.tau : "—"}</td>
                    <td><b>{c ? c.all.f1.toFixed(3) : "—"}</b></td>
                    <td className="row gap">
                      <button className="btn ghost sm" disabled={busy || !!running} onClick={() => calibrate(m)}>{running === m ? "Corriendo…" : c ? "Repetir" : "Correr"}</button>
                      {c && <button className="btn ghost sm" onClick={() => setShowPairs(showPairs === m ? null : m)}>Pares</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">τ = punto medio del rango de umbrales que maximiza F1. Un τ alto reduce falsos «cubierto»; uno bajo, requisitos omitidos.</p>
        {showPairs && (() => {
          const c = calib.find((x) => x.model === showPairs)!;
          return (
            <div className="table-wrap">
              <table className="pairs">
                <thead><tr><th>Set</th><th>Requisito</th><th>Línea de CV</th><th>Etiqueta</th><th>Similitud</th><th>¿≥ τ?</th></tr></thead>
                <tbody>
                  {[...c.scored].sort((a, b) => b.score - a.score).map((p, i) => {
                    const pred = p.score >= c.all.tau;
                    return (
                      <tr key={i} className={pred === p.label ? "" : "miss"}>
                        <td>{p.set}</td><td>{p.req}</td><td>{p.line}</td>
                        <td>{p.label ? "Misma habilidad" : "Distinta"}</td>
                        <td><code>{p.score.toFixed(3)}</code></td>
                        <td>{pred ? "Sí" : "No"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      <div className="card">
        <h3>Reiniciar el prototipo</h3>
        <p className="muted">Borra todo y vuelve a cargar el escenario de «Ana Solano (ficticia)». Útil entre participantes de las pruebas.</p>
        {!confirmReset
          ? <button className="btn" onClick={() => setConfirmReset(true)}>Reiniciar</button>
          : <div className="row gap"><button className="btn danger" disabled={busy} onClick={reset}>Sí, reiniciar</button><button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancelar</button></div>}
      </div>
    </section>
  );
}
