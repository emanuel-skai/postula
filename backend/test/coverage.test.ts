import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLines, coverage, rankProfiles, bestThreshold, findGenericPhrases, cosine } from "../src/match.ts";

test("splitLines descarta líneas de menos de 4 palabras, viñetas y duplicados", () => {
  const lines = splitLines("• Dominio de SQL avanzado\nSQL\n- Dominio de SQL avanzado\n\n1. Python para análisis de datos", 4);
  assert.deepEqual(lines, ["Dominio de SQL avanzado", "Python para análisis de datos"]);
});

test("cosine de vectores iguales es 1 y ortogonales 0", () => {
  assert.equal(Number(cosine([1, 2, 3], [1, 2, 3]).toFixed(6)), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test("cobertura: s_i = max_j S_ij, cubierto si s_i ≥ τ, evidencia = línea ganadora", () => {
  const reqs = ["req A", "req B", "req C"];
  const Q = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const lines = ["línea A", "línea casi B"];
  const D = [[1, 0, 0], [0.2, 0.9, 0.1]];
  const r = coverage(reqs, Q, lines, D, 0.5);
  assert.equal(r.covered, 2);
  assert.equal(r.total, 3);
  assert.equal(r.requirements[0].evidence, "línea A");
  assert.equal(r.requirements[1].evidence, "línea casi B");
  assert.equal(r.requirements[2].covered, false);
  assert.equal(r.requirements[2].evidence, null);
});

test("cobertura con CV vacío: nada cubierto", () => {
  const r = coverage(["req"], [[1, 0]], [], [], 0.3);
  assert.equal(r.covered, 0);
  assert.equal(r.requirements[0].evidence, null);
});

test("recomendado = más cubiertos; empate → mayor promedio", () => {
  const mk = (id: string, covered: number, meanScore: number) =>
    ({ profileId: id, profileName: id, covered, total: 5, meanScore, lines: 3, requirements: [] });
  const ranked = rankProfiles([mk("a", 3, 0.4), mk("b", 4, 0.3), mk("c", 4, 0.5)]);
  assert.deepEqual(ranked.map((p) => p.profileId), ["c", "b", "a"]);
});

test("bestThreshold maximiza F1", () => {
  const pairs = [
    { score: 0.9, label: true }, { score: 0.7, label: true }, { score: 0.6, label: true },
    { score: 0.5, label: false }, { score: 0.3, label: false }, { score: 0.2, label: false },
  ];
  const b = bestThreshold(pairs);
  assert.equal(b.f1, 1);
  assert.ok(b.tau > 0.5 && b.tau <= 0.6, `tau=${b.tau}`);
});

test("H6: detecta la frase genérica de ejemplo", () => {
  const g = findGenericPhrases("Hola.\nMe interesa cualquier puesto disponible en su empresa.\nTengo experiencia en SQL.");
  assert.equal(g.length, 1);
  assert.match(g[0], /cualquier puesto/);
  assert.equal(findGenericPhrases("Me postulo porque construí tableros de ventas.").length, 0);
});
