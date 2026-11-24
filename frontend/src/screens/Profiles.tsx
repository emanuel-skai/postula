import { useEffect, useState } from "react";
import { api, type AppState, type Profile } from "../api";
import { go, useData } from "../App";

const MAX = 3;
const countValid = (cv: string) => cv.split("\n").filter((l) => l.trim().split(/\s+/).filter(Boolean).length >= 4).length;

export function Profiles() {
  const { state, run, setState, busy, toast } = useData();
  const [adding, setAdding] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const profiles = state!.profiles;
  const wipe = () => run(async () => {
    const r = await api<{ deleted: number }>("/api/me", { method: "DELETE" });
    setState(await api<AppState>("/api/state"));
    toast(`Se borraron ${r.deleted} registros: perfiles, exclusiones, vacantes, solicitudes y vectores.`);
    setConfirmWipe(false);
    go("#/vacantes");
  });
  const seed = () => run(async () => {
    setState(await api<AppState>("/api/seed", { method: "POST" }));
    toast("Se cargó el perfil de ejemplo «Ana Solano» con tres versiones de CV.");
  });
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h1>Mis perfiles</h1>
          <p className="muted">Hasta {MAX} versiones de tu CV. Escribe un logro por línea; las líneas de menos de 4 palabras no se analizan.</p>
        </div>
        {profiles.length < MAX && !adding && <button className="btn" onClick={() => setAdding(true)}>+ Nuevo perfil</button>}
      </div>
      {!profiles.length && !adding && (
        <div className="seed-banner card">
          <div>
            <b>Carga datos de ejemplo</b>
            <span className="muted">Rellena el perfil ficticio de «Ana Solano» (analista de datos) con tres CV listos para probar el análisis.</span>
          </div>
          <button className="btn primary" disabled={busy} onClick={seed}>{busy ? "Cargando…" : "Cargar datos de ejemplo"}</button>
        </div>
      )}
      {adding && <ProfileEditor onDone={() => setAdding(false)} />}
      {profiles.map((p) => <ProfileEditor key={p.id} profile={p} />)}
      {!profiles.length && !adding && <div className="card center muted">Sin perfiles todavía. Crea uno con «+ Nuevo perfil» o carga el de ejemplo.</div>}

      <div className="card danger-zone">
        <h3>Borrar mis datos</h3>
        <p className="muted">Elimina de forma permanente tus perfiles, exclusiones, vacantes, solicitudes y los vectores calculados de tus textos.</p>
        {!confirmWipe
          ? <button className="btn danger" onClick={() => setConfirmWipe(true)}>Borrar mis datos</button>
          : <div className="row gap wrap"><b>¿Seguro? No se puede deshacer.</b><button className="btn danger" disabled={busy} onClick={wipe}>Sí, borrar todo</button><button className="btn ghost" onClick={() => setConfirmWipe(false)}>Cancelar</button></div>}
      </div>
    </section>
  );
}

function ProfileEditor({ profile, onDone }: { profile?: Profile; onDone?: () => void }) {
  const { run, setState, busy, toast } = useData();
  const [name, setName] = useState(profile?.name ?? "");
  const [cv, setCv] = useState(profile?.cv ?? "");
  const [confirmDel, setConfirmDel] = useState(false);
  const [parsing, setParsing] = useState(false);
  useEffect(() => { setName(profile?.name ?? ""); setCv(profile?.cv ?? ""); }, [profile?.updatedAt]);
  const dirty = !profile || name !== profile.name || cv !== profile.cv;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      setState(await api<AppState>(profile ? `/api/profiles/${profile.id}` : "/api/profiles", { method: profile ? "PUT" : "POST", body: { name, cv } }));
      toast(profile ? "Perfil actualizado" : "Perfil creado");
      onDone?.();
    });
  };
  const del = () => run(async () => { setState(await api(`/api/profiles/${profile!.id}`, { method: "DELETE" })); });
  // #9 · Importar un CV en PDF: el texto se extrae EN EL NAVEGADOR y se vuelca al textarea para revisarlo.
  const onPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast("Elige un archivo PDF", "error");
      return;
    }
    setParsing(true);
    try {
      const { extractPdfText } = await import("../pdf"); // carga la librería solo al usarla
      const text = await extractPdfText(file);
      if (!text) { toast("No se pudo extraer texto (¿es un PDF escaneado como imagen?)", "error"); return; }
      setCv((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
      toast("Texto del PDF importado. Revísalo: deja un logro por línea.");
    } catch (err) {
      toast(`No se pudo leer el PDF: ${(err as Error).message}`, "error");
    } finally {
      setParsing(false);
    }
  };
  return (
    <form className="card form" onSubmit={save}>
      <label>Nombre del perfil<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Analista de datos" /></label>
      <label>CV <span className="opt">{countValid(cv)} líneas válidas</span>
        <textarea rows={7} value={cv} onChange={(e) => setCv(e.target.value)} placeholder={"Construí tableros en Power BI para ventas regionales\nEscribí consultas SQL complejas para reportes mensuales"} />
      </label>
      <div className="row gap wrap import-row">
        <label className="btn ghost sm file-btn">
          {parsing ? "Leyendo PDF…" : "Importar CV en PDF"}
          <input type="file" accept="application/pdf,.pdf" onChange={onPdf} disabled={parsing} hidden />
        </label>
        <span className="muted small">El PDF se procesa en tu navegador; no se sube a ningún servidor. Luego ajusta el texto a un logro por línea.</span>
      </div>
      <div className="row between wrap gap">
        {profile
          ? (!confirmDel
            ? <button type="button" className="btn ghost sm" onClick={() => setConfirmDel(true)}>Eliminar perfil</button>
            : <span className="row gap"><button type="button" className="btn danger sm" onClick={del}>Sí, eliminar</button><button type="button" className="btn ghost sm" onClick={() => setConfirmDel(false)}>No</button></span>)
          : <button type="button" className="btn ghost sm" onClick={onDone}>Cancelar</button>}
        <button className="btn primary" disabled={busy || !dirty}>{profile ? "Guardar cambios" : "Crear perfil"}</button>
      </div>
    </form>
  );
}
