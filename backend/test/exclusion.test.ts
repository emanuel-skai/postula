import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCompany, checkExclusion } from "../src/exclusion.ts";

test("normaliza tildes, mayúsculas, puntuación y sufijos societarios", () => {
  assert.equal(normalizeCompany("Empresa Actual S.A."), "empresa actual");
  assert.equal(normalizeCompany("EMPRESA  ACTUAL, S.R.L."), "empresa actual");
  assert.equal(normalizeCompany("Logística Ñandú Ltda."), "logistica nandu");
  assert.equal(normalizeCompany("Acme Inc."), "acme");
  assert.equal(normalizeCompany("Foo S.A. Inc"), "foo");
  assert.equal(normalizeCompany("  "), "");
});

test("H2: exclusión «Empresa Actual S.A.» bloquea la vacante de «Empresa Actual»", () => {
  const v = checkExclusion("Empresa Actual", ["Empresa Actual S.A."]);
  assert.equal(v.status, "blocked");
});

test("CU-01: coincidencia sin distinguir mayúsculas ni tildes bloquea", () => {
  assert.equal(checkExclusion("empresa actual", ["Empresa Actual"]).status, "blocked");
  assert.equal(checkExclusion("Compañía Óptima", ["compania optima s.a."]).status, "blocked");
});

test("nombre que contiene al excluido pide revisión, no bloquea", () => {
  const v = checkExclusion("Empresa Actual Servicios S.A.", ["Empresa Actual"]);
  assert.equal(v.status, "review");
});

test("nombre casi igual (errata) pide revisión", () => {
  assert.equal(checkExclusion("Empresa Actaul", ["Empresa Actual"]).status, "review");
});

test("revisión reconocida por la persona deja continuar", () => {
  const v = checkExclusion("Empresa Actual Servicios S.A.", ["Empresa Actual"], ["Empresa Actual"]);
  assert.equal(v.status, "allowed");
});

test("bloqueo exacto gana aunque haya reconocimiento previo", () => {
  const v = checkExclusion("Empresa Actual", ["Empresa Actual"], ["Empresa Actual"]);
  assert.equal(v.status, "blocked");
});

test("empresa distinta queda permitida", () => {
  assert.equal(checkExclusion("Empresa Destino", ["Empresa Actual"]).status, "allowed");
  assert.equal(checkExclusion("Nova Logística S.R.L.", ["Empresa Actual", "Otra"]).status, "allowed");
});

test("palabra parcial no dispara revisión («Actualidad» ≠ «Actual»)", () => {
  assert.equal(checkExclusion("Grupo Actualidad", ["Actual"]).status, "allowed");
});

test("lista vacía permite todo", () => {
  assert.equal(checkExclusion("Empresa Actual", []).status, "allowed");
});
