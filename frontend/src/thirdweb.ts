import { createThirdwebClient } from "thirdweb";
import type { SiweAuthOptions } from "thirdweb/react";
import { createWallet, inAppWallet } from "thirdweb/wallets";
import { api, setToken, getToken } from "./api";

// Mismo client ID que app.potenci.ai → la misma cuenta (wallet) que el usuario ya tiene en potenci.
export const client = createThirdwebClient({ clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID as string });

export const wallets = [
  inAppWallet({ auth: { options: ["email", "google", "apple", "passkey"] } }),
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
];

// SIWE contra el auth server de potenci, vía el backend de Postula (proxy server-to-server).
export const auth: SiweAuthOptions = {
  getLoginPayload: async ({ address }) => api(`/api/auth/payload?address=${encodeURIComponent(address)}&chainId=1`, { auth: false }),
  doLogin: async (params) => {
    const r = await api<{ token?: string }>("/api/auth/login", { method: "POST", body: params, auth: false });
    if (!r.token) throw new Error("No se recibió token");
    setToken(String(r.token));
    window.dispatchEvent(new Event("postula-auth"));
  },
  isLoggedIn: async () => {
    if (!getToken()) return false;
    try { await api("/api/auth/me"); return true; } catch { return false; }
  },
  doLogout: async () => {
    setToken(null);
    window.dispatchEvent(new Event("postula-auth"));
  },
};
