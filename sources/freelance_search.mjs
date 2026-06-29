#!/usr/bin/env node
/**
 * freelance_search.mjs — поиск фриланс-проектов и контрактных ролей.
 *
 * Источники (все легальные, через API/фиды, VPN-safe):
 *   - Freelancer.com  — официальный API активных проектов (настоящий фриланс)
 *   - Remotive        — роли с типом contract/freelance
 *   - RemoteOK        — роли с тегом contract/freelance
 *
 * Честно: Upwork / Fiverr / Kwork НЕ подключены — у них нет открытого API
 * и скрапинг нарушает их правила. (Можно добавить позже через браузерную
 * автоматизацию, но это сложнее.)
 *
 * Результаты пишутся в data/pipeline.md → дальше /career-ops pipeline.
 *
 * Примеры:
 *   node freelance_search.mjs "telegram bot" "landing page" "automation"
 *   node freelance_search.mjs "react" --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIPELINE = join(ROOT, "data", "pipeline.md");
const UA = { headers: { "User-Agent": "JobForge/1.0", Accept: "*/*" } };

const args = process.argv.slice(2);
const queries = [];
let dryRun = false;
for (const a of args) (a === "--dry-run" ? (dryRun = true) : queries.push(a));

const clean = (s) => (s == null ? "" : String(s)).replace(/<[^>]+>/g, " ").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
// Слишком общие слова не считаем за совпадение (иначе матчится всё подряд).
const STOP = new Set(["engineer", "developer", "dev", "remote", "senior", "junior", "specialist", "role", "job", "work", "mid", "lead", "staff", "principal", "the", "and", "for"]);
// Берём все значимые слова из всех запросов (длиннее 2 символов, не стоп-слова).
const terms = [...new Set(queries.flatMap((q) => q.toLowerCase().split(/\s+/)).filter((w) => w.length >= 3 && !STOP.has(w)))];
// Совпадает, если в вакансии встречается ХОТЬ ОДНО значимое слово.
const matches = (hay) => terms.length === 0 || (hay = hay.toLowerCase(), terms.some((w) => hay.includes(w)));
async function getJSON(url) { const r = await fetch(url, UA); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
const isFreelance = (s) => /contract|freelance|temporary/i.test(s || "");

// ---------- источники ----------
async function freelancer() {
  const out = [];
  for (const q of (queries.length ? queries : ["remote"])) {
    const d = await getJSON(`https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(q)}&limit=30&full_description=true`);
    for (const p of d.result?.projects || []) {
      const b = p.budget || {};
      const budget = b.minimum ? `${b.minimum}–${b.maximum || ""} ${p.currency?.code || ""}`.trim() : (p.type || "");
      out.push({ url: "https://www.freelancer.com/projects/" + p.seo_url, company: "Freelancer.com", title: p.title, location: `Freelance · ${budget}`, hay: `${p.title} ${p.preview_description || ""}` });
    }
  }
  return out;
}
async function remotiveContract() {
  const out = [];
  for (const q of (queries.length ? queries : [""])) {
    const d = await getJSON(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`);
    for (const j of (d.jobs || []).filter((x) => isFreelance(x.job_type)))
      out.push({ url: j.url, company: j.company_name, title: j.title, location: j.candidate_required_location || "Remote", hay: `${j.title} ${(j.tags || []).join(" ")}` });
  }
  return out;
}
async function remoteokContract() {
  const d = await getJSON("https://remoteok.com/api");
  return d.filter((j) => j && j.position && (isFreelance((j.tags || []).join(" ")) || isFreelance(j.position)))
    .map((j) => ({ url: j.url, company: j.company, title: j.position, location: j.location || "Remote", hay: `${j.position} ${(j.tags || []).join(" ")}` }));
}
const SOURCES = { "Freelancer.com": freelancer, "Remotive (contract)": remotiveContract, "RemoteOK (contract)": remoteokContract };

// ---------- сбор ----------
const all = [];
const errors = [];
for (const [name, fn] of Object.entries(SOURCES)) {
  try {
    const jobs = (await fn()).filter((j) => j.url && matches(j.hay));
    all.push(...jobs);
    console.log(`  ${name}: ${jobs.length}`);
  } catch (e) { errors.push(`${name}: ${e.message}`); }
}

let pipe = existsSync(PIPELINE) ? readFileSync(PIPELINE, "utf-8") : "";
const seen = new Set();
const lines = [];
for (const j of all) {
  if (seen.has(j.url) || pipe.includes(j.url)) continue;
  seen.add(j.url);
  lines.push(`- [ ] ${j.url} | ${clean(j.company)} | ${clean(j.title)} | ${clean(j.location)}`);
}

if (errors.length) { console.log("\n⚠️  Проблемы:"); errors.forEach((e) => console.log("   - " + e)); }
console.log("\nℹ️  Upwork / Fiverr / Kwork не подключены (нет открытого API).");
if (lines.length === 0) { console.log("Новых фриланс-вакансий нет."); process.exit(0); }
if (dryRun) { console.log(`\n[dry-run] ${lines.length} новых:\n` + lines.join("\n")); process.exit(0); }

if (!pipe.includes("## Pending")) pipe = (pipe || "# Pipeline — Pending URLs\n") + "\n## Pending\n\n## Processed\n";
const idx = pipe.indexOf("## Pending") + "## Pending".length;
const nxt = pipe.indexOf("\n## ", idx);
const at = nxt === -1 ? pipe.length : nxt;
writeFileSync(PIPELINE, pipe.slice(0, at) + "\n" + lines.join("\n") + "\n" + pipe.slice(at), "utf-8");
console.log(`\n✅ Добавил ${lines.length} фриланс-вакансий в data/pipeline.md\nДальше: /career-ops pipeline`);
