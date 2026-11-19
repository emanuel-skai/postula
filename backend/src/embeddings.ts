// Vectorización con Cohere Embed (clave leída de SSM en runtime; nunca llega al navegador).
// Caché por usuario en DynamoDB: el mismo texto no se vuelve a vectorizar,
// y «Borrar mis datos» también borra los vectores.
import { createHash } from "node:crypto";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { batchGet, batchPut } from "./db.js";

const PARAM = process.env.COHERE_KEY_PARAM || "/postula/prod/COHERE_API_KEY";
let keyPromise: Promise<string> | null = null;

function cohereKey(): Promise<string> {
  if (process.env.COHERE_API_KEY) return Promise.resolve(process.env.COHERE_API_KEY);
  keyPromise ??= new SSMClient({})
    .send(new GetParameterCommand({ Name: PARAM, WithDecryption: true }))
    .then((r) => r.Parameter?.Value ?? "")
    .catch((e) => {
      keyPromise = null;
      throw e;
    });
  return keyPromise;
}

export type InputType = "search_query" | "search_document" | "classification" | "clustering";

async function cohereEmbed(texts: string[], model: string, inputType: InputType): Promise<number[][]> {
  const key = await cohereKey();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96);
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://api.cohere.com/v2/embed", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, texts: batch, input_type: inputType, embedding_types: ["float"], truncate: "END" }),
      });
      if (res.ok) {
        const data: any = await res.json();
        out.push(...data.embeddings.float);
        lastErr = "";
        break;
      }
      lastErr = `Cohere ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.status < 500 && res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    if (lastErr) throw new Error(lastErr);
  }
  return out;
}

const toB = (v: number[]) => Buffer.from(new Float32Array(v).buffer);
const fromB = (b: Uint8Array) =>
  Array.from(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));

export interface EmbedStats { requested: number; cached: number; computed: number; ms: number }

/** Vectoriza con caché por usuario. Si `pk` es null no usa caché (calibración). */
export async function embed(
  texts: string[],
  model: string,
  inputType: InputType,
  pk: string | null,
  stats?: EmbedStats,
): Promise<number[][]> {
  const t0 = Date.now();
  const sk = (t: string) => `EMB#${model}#${inputType}#${createHash("sha256").update(t).digest("hex").slice(0, 32)}`;
  const cached = pk ? await batchGet(pk, texts.map(sk)) : {};
  const missing = [...new Set(texts.filter((t) => !cached[sk(t)]))];
  const fresh = missing.length ? await cohereEmbed(missing, model, inputType) : [];
  const freshMap = new Map(missing.map((t, i) => [t, fresh[i]]));
  if (pk && missing.length)
    await batchPut(missing.map((t, i) => ({ pk, sk: sk(t), v: toB(fresh[i]), model, createdAt: Date.now() })));
  if (stats) {
    stats.requested += texts.length;
    stats.computed += missing.length;
    stats.cached += texts.length - missing.length;
    stats.ms += Date.now() - t0;
  }
  return texts.map((t) => freshMap.get(t) ?? fromB(cached[sk(t)].v));
}

export async function pingCohere(model: string): Promise<{ ok: boolean; dim?: number; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const [v] = await cohereEmbed(["prueba de motor"], model, "search_query");
    return { ok: true, dim: v.length, ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 160) };
  }
}
