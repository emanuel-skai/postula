// Login con Thirdweb reutilizando el auth server de potenci (SIWE → JWT).
// El Lambda hace de proxy server-to-server: no hay que tocar CORS ni redeployar el auth de prod.
const AUTH = process.env.AUTH_API || "https://auth.potenci.ai";

const cache = new Map<string, { addr: string; until: number }>();

// Wallets con rol de reclutador (admin). Se configuran en el env del Lambda
// (ADMIN_WALLETS=0xabc...,0xdef...). Vacío = nadie es admin.
const ADMIN_WALLETS = new Set(
  (process.env.ADMIN_WALLETS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
export const isAdmin = (addr: string) => ADMIN_WALLETS.has(addr.toLowerCase());


export async function loginPayload(address: string, chainId?: string) {
  const qs = new URLSearchParams({ address, chainId: chainId || "1" });
  const r = await fetch(`${AUTH}/login?${qs}`);
  if (!r.ok) throw new HttpError(502, "No se pudo generar el mensaje de inicio de sesión");
  return r.json();
}

export async function doLogin(params: unknown) {
  const r = await fetch(`${AUTH}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  if (!r.ok) throw new HttpError(401, "Firma inválida");
  return r.json();
}

function decodeJwt(token: string): any {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Devuelve la wallet (address) del usuario o lanza 401. */
export async function requireUser(authHeader: string | undefined): Promise<string> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Sesión requerida");
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.until > now) return hit.addr;

  const claims = decodeJwt(token);
  const addr: string | undefined = claims?.sub;
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new HttpError(401, "Token inválido");
  if (claims.exp && claims.exp * 1000 < now) throw new HttpError(401, "Sesión expirada");

  // La firma y el emisor los valida el auth server de potenci (fuente de verdad).
  const r = await fetch(`${AUTH}/isLoggedIn`, { headers: { Authorization: `Bearer ${token}` } });
  const ok = r.ok && (await r.json()) === true;
  if (!ok) throw new HttpError(401, "Sesión inválida");

  const until = Math.min(now + 10 * 60_000, claims.exp ? claims.exp * 1000 : Infinity);
  cache.set(token, { addr: addr.toLowerCase(), until });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return addr.toLowerCase();
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
