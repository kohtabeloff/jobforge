#!/usr/bin/env node
/**
 * boards_search.mjs — поиск по «хорошим» remote-бордам через их БЕСПЛАТНЫЕ фиды
 * (API/RSS), а не через WebSearch. Отдают десятки вакансий и не блокируются VPN.
 *
 * Борды: Remotive, RemoteOK, WeWorkRemotely (RSS), Working Nomads, Jobicy.
 * Результаты пишутся в data/pipeline.md → дальше /career-ops pipeline.
 *
 * Примеры:
 *   node boards_search.mjs "automation" "frontend" "AI"
 *   node boards_search.mjs "react" --dry-run
 *   node boards_search.mjs "python" --boards remotive,remoteok
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PIPELINE = join(ROOT, "data", "pipeline.md");
const UA = { headers: { "User-Agent": "JobForge/1.0", Accept: "*/*" } };

// ---------- аргументы ----------
const args = process.argv.slice(2);
const queries = [];
let boards = ["remotive", "remoteok", "weworkremotely", "workingnomads"];
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--boards") boards = args[++i].split(",").map((s) => s.trim());
  else if (args[i] === "--dry-run") dryRun = true;
  else queries.push(args[i]);
}

const clean = (s) => (s == null ? "" : String(s)).replace(/<[^>]+>/g, " ").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
// Слишком общие слова не считаем за совпадение (иначе матчится всё подряд).
const STOP = new Set(["engineer", "developer", "dev", "remote", "senior", "junior", "specialist", "role", "job", "work", "mid", "lead", "staff", "principal", "the", "and", "for"]);
// Берём все значимые слова из всех запросов (длиннее 2 символов, не стоп-слова).
const terms = [...new Set(queries.flatMap((q) => q.toLowerCase().split(/\s+/)).filter((w) => w.length >= 3 && !STOP.has(w)))];
// Совпадает, если в вакансии встречается ХОТЬ ОДНО значимое слово.
function matches(hay) {
  if (terms.length === 0) return true; // нет запросов → берём всё
  hay = hay.toLowerCase();
  return terms.some((w) => hay.includes(w));
}
async function getJSON(url) { const r = await fetch(url, UA); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
async function getText(url) { const r = await fetch(url, UA); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }

// ---------- борды ----------
async function remotive() {
  const out = [];
  for (const q of (queries.length ? queries : [""])) {
    const d = await getJSON(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`);
    for (const j of d.jobs || []) out.push({ url: j.url, company: j.company_name, title: j.title, location: j.candidate_required_location || "Remote", hay: `${j.title} ${(j.tags||[]).join(" ")}` });
  }
  return out;
}
async function remoteok() {
  const d = await getJSON("https://remoteok.com/api");
  return d.filter((j) => j && j.position).map((j) => ({ url: j.url, company: j.company, title: j.position, location: j.location || "Remote", hay: `${j.position} ${(j.tags||[]).join(" ")} ${j.description||""}` }));
}
async function weworkremotely() {
  const cats = ["remote-programming-jobs", "remote-devops-sysadmin-jobs", "remote-design-jobs", "remote-product-jobs"];
  const out = [];
  for (const c of cats) {
    const xml = await getText(`https://weworkremotely.com/categories/${c}.rss`);
    for (const item of xml.split("<item>").slice(1)) {
      const get = (t) => (item.match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || "";
      const rawTitle = clean(get("title"));
      const link = clean(get("link"));
      const region = clean(get("region"));
      const [company, ...rest] = rawTitle.split(":");
      const title = rest.length ? rest.join(":").trim() : rawTitle;
      out.push({ url: link, company: rest.length ? company.trim() : "", title, location: region || "Remote", hay: rawTitle });
    }
  }
  return out;
}
async function workingnomads() {
  const d = await getJSON("https://www.workingnomads.com/api/exposed_jobs/");
  return d.map((j) => ({ url: j.url, company: j.company_name, title: j.title, location: j.location || "Remote", hay: `${j.title} ${j.category_name||""} ${j.tags||""}` }));
}
async function jobicy() {
  const out = [];
  for (const q of (queries.length ? queries : [""])) {
    const d = await getJSON(`https://jobicy.com/api/v2/remote-jobs?count=50${q ? `&tag=${encodeURIComponent(q)}` : ""}`);
    for (const j of d.jobs || []) out.push({ url: j.url, company: j.companyName, title: j.jobTitle, location: j.jobGeo || "Remote", hay: `${j.jobTitle} ${j.jobExcerpt||""}` });
  }
  return out;
}
const FN = { remotive, remoteok, weworkremotely, workingnomads, jobicy };

// ---------- сбор ----------
const all = [];
const errors = [];
for (const b of boards) {
  if (!FN[b]) { errors.push(`${b}: неизвестный борд`); continue; }
  try {
    const jobs = await FN[b]();
    const kept = jobs.filter((j) => j.url && matches(j.hay));
    kept.forEach((j) => (j.source = b));
    all.push(...kept);
    console.log(`  ${b}: ${kept.length} (из ${jobs.length})`);
  } catch (e) { errors.push(`${b}: ${e.message}`); }
}

// дедуп внутри + против pipeline
let pipe = existsSync(PIPELINE) ? readFileSync(PIPELINE, "utf-8") : "";
const seen = new Set();
const lines = [];
for (const j of all) {
  if (seen.has(j.url) || pipe.includes(j.url)) continue;
  seen.add(j.url);
  lines.push(`- [ ] ${j.url} | ${clean(j.company)} | ${clean(j.title)} | ${clean(j.location)}`);
}

if (errors.length) { console.log("\n⚠️  Проблемы:"); errors.forEach((e) => console.log("   - " + e)); }
if (lines.length === 0) { console.log("\nНовых вакансий нет."); process.exit(0); }
if (dryRun) { console.log(`\n[dry-run] ${lines.length} новых:\n` + lines.join("\n")); process.exit(0); }

if (!pipe.includes("## Pending")) pipe = (pipe || "# Pipeline — Pending URLs\n") + "\n## Pending\n\n## Processed\n";
const idx = pipe.indexOf("## Pending") + "## Pending".length;
const nxt = pipe.indexOf("\n## ", idx);
const at = nxt === -1 ? pipe.length : nxt;
writeFileSync(PIPELINE, pipe.slice(0, at) + "\n" + lines.join("\n") + "\n" + pipe.slice(at), "utf-8");
console.log(`\n✅ Добавил ${lines.length} вакансий в data/pipeline.md\nДальше: /career-ops pipeline`);
