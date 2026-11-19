import calib from "../src/calibration_pairs.json" with { type: "json" };
import { embed } from "../src/embeddings.ts";
import { cosine, bestThreshold } from "../src/match.ts";
for (const m of ["embed-v4.0", "embed-multilingual-v3.0", "embed-multilingual-light-v3.0"]) {
  const t0 = Date.now();
  const Q = await embed(calib.pairs.map(p => p.req), m, "search_query", null);
  const D = await embed(calib.pairs.map(p => p.line), m, "search_document", null);
  const ms = Date.now() - t0;
  const s = calib.pairs.map((p, i) => ({ score: cosine(Q[i], D[i]), label: p.label, set: p.set, line: p.line }));
  for (const [name, sub] of [["A", s.filter(x => x.set === "A")], ["A+B", s]] as const) {
    const b = bestThreshold(sub);
    console.log(m.padEnd(30), name.padEnd(4), "dim", Q[0].length, "ms", ms, "tau", b.tau, "range", b.range.join("–"), "F1", b.f1.toFixed(3), "P", b.precision.toFixed(2), "R", b.recall.toFixed(2));
  }
  if (m === "embed-v4.0") for (const x of s.filter(x => x.set === "B")) console.log("   B", x.label ? "T" : "F", x.score.toFixed(3), x.line.slice(0, 60));
}
