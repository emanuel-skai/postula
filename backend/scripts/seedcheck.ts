import { embed } from "../src/embeddings.ts";
import { splitLines, coverage, rankProfiles } from "../src/match.ts";
import { SEED_PROFILES, SEED_VACANCIES } from "../src/seed.ts";
import config from "../src/config.json" with { type: "json" };
for (const v of SEED_VACANCIES) {
  const reqs = splitLines(v.requirements, 4);
  const Q = await embed(reqs, config.model, "search_query", null);
  const res = [];
  for (const p of SEED_PROFILES) {
    const lines = splitLines(p.cv, 4);
    const D = await embed(lines, config.model, "search_document", null);
    res.push({ profileId: p.name, profileName: p.name, ...coverage(reqs, Q, lines, D, config.tau) });
  }
  const r = rankProfiles(res);
  console.log(`\n## ${v.company} — ${v.title}`);
  for (const p of r) {
    console.log(`  ${p.profileName}: ${p.covered}/${p.total} mean=${p.meanScore.toFixed(3)}`);
    for (const q of p.requirements) console.log(`     ${q.covered ? "✓" : "·"} ${q.score.toFixed(3)} ${q.requirement.slice(0,50)} → ${q.evidence?.slice(0,55) ?? "sin cubrir"}`);
  }
}
