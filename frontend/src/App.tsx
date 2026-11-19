import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AutoConnect, ConnectButton, useActiveAccount } from "thirdweb/react";
import { api, ApiError, getToken, setOnUnauthorized, setToken, type AppState } from "./api";
import { auth, client, wallets } from "./thirdweb";
import { Vacancies, VacancyDetail } from "./screens/Vacancies";
import { ApplicationFlow } from "./screens/Applications";
import { Catalog } from "./screens/Catalog";
import { Admin } from "./screens/Admin";
import { Profiles } from "./screens/Profiles";
import { Exclusions } from "./screens/Exclusions";
import { Engine } from "./screens/Engine";

// ---------- router por hash ----------
export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash || "#/catalogo");
  useEffect(() => {
    const on = () => { setHash(window.location.hash || "#/catalogo"); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const [path, query = ""] = hash.slice(1).split("?");
  return { parts: path.split("/").filter(Boolean), query: new URLSearchParams(query) };
}
export const go = (h: string) => { window.location.hash = h; };

// ---------- contexto de datos ----------
interface Ctx {
  state: AppState | null;
  setState: (s: AppState) => void;
  refresh: () => Promise<void>;
  toast: (msg: string, kind?: "ok" | "error") => void;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  busy: boolean;
}
const DataCtx = createContext<Ctx>(null as any);
export const useData = () => useContext(DataCtx);

const theme = (dark: boolean) => (dark ? "dark" : "light") as "dark" | "light";

export default function App() {
  const account = useActiveAccount();
  const [authed, setAuthed] = useState(() => !!getToken());
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ msg: string; kind: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const route = useRoute();

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme(dark); }, [dark]);

  useEffect(() => {
    const on = () => setAuthed(!!getToken());
    window.addEventListener("postula-auth", on);
    setOnUnauthorized(() => { setToken(null); setAuthed(false); setState(null); });
    return () => window.removeEventListener("postula-auth", on);
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    setToastMsg({ msg, kind });
    window.clearTimeout((toast as any)._t);
    (toast as any)._t = window.setTimeout(() => setToastMsg(null), 3800);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      setState(await api<AppState>("/api/state"));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setLoadError((e as Error).message);
    }
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try { return await fn(); }
    catch (e) { toast((e as Error).message, "error"); return undefined; }
    finally { setBusy(false); }
  }, [toast]);

  useEffect(() => { if (authed) refresh(); else setState(null); }, [authed, refresh]);

  const ctx = useMemo(() => ({ state, setState, refresh, toast, run, busy }), [state, refresh, toast, run, busy]);

  const connect = (
    <ConnectButton
      client={client}
      wallets={wallets}
      auth={auth}
      locale="es_ES"
      theme={theme(dark)}
      connectButton={{ label: "Iniciar sesión" }}
      signInButton={{ label: "Firmar e ingresar" }}
      connectModal={{ title: "Ingresa con tu cuenta potenci", size: "compact", showThirdwebBranding: false }}
      detailsButton={{ style: { height: 36, minWidth: 0, padding: "0 10px" } }}
    />
  );

  const tab = route.parts[0] ?? "catalogo";
  const nav: [string, string][] = [
    ...(state?.isAdmin ? [["admin", "Reclutador"] as [string, string]] : []),
    ["catalogo", "Vacantes"],
    ["postulaciones", "Mis postulaciones"],
    ["perfiles", "Perfiles"],
    ["exclusiones", "Exclusiones"],
  ];

  return (
    <DataCtx.Provider value={ctx}>
      <div className="sim-banner" role="note">
        <span className="dot" /> Simulación académica: ningún envío sale de la plataforma. Usa datos ficticios.
      </div>
      <header className="topbar">
        <a className="brand" href="#/catalogo" aria-label="Postula, inicio">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden><rect width="32" height="32" rx="8" fill="var(--fg)" /><path d="M10 23V9h6.5a4.5 4.5 0 0 1 0 9H13" stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>
          <span>Postula</span><small>by potenci</small>
        </a>
        {authed && (
          <nav className="tabs" aria-label="Secciones">
            {nav.map(([k, label]) => {
              const active = tab === k
                || (k === "postulaciones" && (tab === "vacante" || tab === "postulacion"));
              return <a key={k} href={`#/${k}`} className={active ? "active" : ""}>{label}</a>;
            })}
          </nav>
        )}
        <div className="topbar-right">
          {authed && (
            <a href="#/motor" className={`icon-btn ${tab === "motor" ? "active" : ""}`} title="Motor y configuración" aria-label="Motor y configuración">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
            </a>
          )}
          <button className="icon-btn" onClick={() => setDark(!dark)} title="Cambiar tema" aria-label="Cambiar tema">
            {dark ? "☀" : "☾"}
          </button>
          <AutoConnect client={client} wallets={wallets} />
          {authed && account && <div className="connect-slot">{connect}</div>}
          {authed && !account && (
            <button className="btn ghost sm" onClick={() => { setToken(null); setAuthed(false); }}>Salir</button>
          )}
        </div>
      </header>

      <main className="page">
        {!authed ? (
          <Landing connect={connect} />
        ) : loadError ? (
          <div className="card center">
            <p>No pudimos cargar tus datos: {loadError}</p>
            <button className="btn" onClick={refresh}>Reintentar</button>
          </div>
        ) : !state ? (
          <Skeleton />
        ) : (
          <Screen parts={route.parts} query={route.query} />
        )}
      </main>

      {toastMsg && <div className={`toast ${toastMsg.kind}`} role="status">{toastMsg.msg}</div>}
    </DataCtx.Provider>
  );
}

function Screen({ parts, query }: { parts: string[]; query: URLSearchParams }) {
  const { state } = useData();
  const empty = state && !state.profiles.length && !state.vacancies.length && !state.exclusions.length;
  switch (parts[0]) {
    case "catalogo": return <Catalog />;
    case "admin": return <Admin />;
    case "postulaciones": return <Vacancies />;
    case "vacante": return <VacancyDetail id={parts[1]} />;
    case "postulacion": return <ApplicationFlow id={parts[1]} step={query.get("paso")} />;
    case "perfiles": return <Profiles />;
    case "exclusiones": return <Exclusions />;
    case "motor": return <Engine />;
    default: return empty ? <Onboarding /> : <Catalog />;
  }
}

function Landing({ connect }: { connect: React.ReactNode }) {
  return (
    <section className="hero">
      <p className="eyebrow">Prototipo funcional · Design Sprint CENFOTEC</p>
      <h1>Postúlate con discreción.<br /><span className="muted">Con control de lo que envías.</span></h1>
      <p className="lead">
        Excluye a tu empleador actual, compara tus perfiles con cada vacante usando embeddings y aprueba
        cada postulación antes de enviarla. Sabrás qué se envió y qué no está confirmado.
      </p>
      <div className="hero-cta">{connect}</div>
      <ul className="hero-points">
        <li><b>Exclusión verificable</b><span>Bloquea empresas aunque se escriban con S.A., tildes o variantes.</span></li>
        <li><b>Perfil recomendado</b><span>«X de N requisitos cubiertos», con la línea de tu CV que lo respalda.</span></li>
        <li><b>Estados honestos</b><span>Preparada, enviada y recepción confirmada (solo con evidencia).</span></li>
      </ul>
      <p className="fineprint">Usas la misma cuenta de potenci (correo, Google, Apple, passkey o wallet).</p>
    </section>
  );
}

function Onboarding() {
  const { run, setState, busy } = useData();
  return (
    <section className="card onboarding">
      <p className="eyebrow">Bienvenida</p>
      <h2>Empieza con el escenario del Sprint</h2>
      <p className="muted">
        Carga el perfil ficticio de «Ana Solano», analista de datos, con tres versiones de CV. Las vacantes
        (Empresa Actual —tu empleador en la simulación—, Empresa Destino, una de nombre parecido y una de otra área)
        ya están publicadas en el catálogo por el reclutador.
      </p>
      <div className="row gap">
        <button className="btn primary" disabled={busy} onClick={() => run(async () => setState(await api("/api/seed", { method: "POST" })))}>
          {busy ? "Cargando…" : "Cargar datos de ejemplo"}
        </button>
        <a className="btn ghost" href="#/perfiles">Empezar desde cero</a>
      </div>
      <ol className="steps-hint">
        <li>CU-01 · Agrega «Empresa Actual» en <a href="#/exclusiones">Exclusiones</a> y mírala excluida en el <a href="#/catalogo">catálogo</a>.</li>
        <li>CU-02 · Postúlate a Empresa Destino desde el catálogo, analízala, corrige el texto y aprueba.</li>
        <li>CU-03 · Revisa el estado en <a href="#/postulaciones">Mis postulaciones</a>.</li>
      </ol>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="stack">
      {[0, 1, 2].map((i) => <div key={i} className="card skeleton" />)}
    </div>
  );
}
