#!/usr/bin/env node
/**
 * hh-search.mjs — поиск удалённых вакансий на hh.ru и добавление их
 * во «входящий список» career-ops (data/pipeline.md).
 *
 * После запуска просто выполни в career-ops:  /career-ops pipeline
 * — и hh-вакансии оценятся так же, как международные.
 *
 * ⚠️ hh.ru блокирует серверные и зарубежные IP. Запускай с домашнего
 *    компьютера и ЛУЧШЕ С ВЫКЛЮЧЕННЫМ VPN (или с VPN на Россию).
 *
 * Примеры:
 *   node hh-search.mjs "react разработчик" "frontend"
 *   node hh-search.mjs "python" --area 113 --period 7 --per-page 50
 *   node hh-search.mjs "телеграм бот" --dry-run        // показать, не записывать
 *
 * Параметры:
 *   --area N      регион (113 = Россия, по умолчанию). Справочник: https://api.hh.ru/areas
 *   --period N    за сколько последних дней (по умолчанию 14)
 *   --per-page N  сколько вакансий на запрос (по умолчанию 30, максимум 100)
 *   --dry-run     только показать, ничего не писать в pipeline.md
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const PIPELINE_PATH = 'data/pipeline.md';
const UA = 'career-ops-hh-search/1.0 (job search helper)';

// ---------- разбор аргументов ----------
const args = process.argv.slice(2);
const queries = [];
const opts = { area: '113', period: '14', perPage: '30', dryRun: false };

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--area') opts.area = args[++i];
  else if (a === '--period') opts.period = args[++i];
  else if (a === '--per-page') opts.perPage = args[++i];
  else if (a === '--dry-run') opts.dryRun = true;
  else queries.push(a);
}

if (queries.length === 0) {
  console.error('Укажи хотя бы один запрос. Пример: node hh-search.mjs "react разработчик"');
  process.exit(1);
}

// ---------- хелперы ----------
function clean(s) {
  // убираем символы, ломающие формат pipeline (| и переносы строк)
  return (s || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

async function searchHH(query) {
  const params = new URLSearchParams({
    text: query,
    schedule: 'remote',
    area: opts.area,
    period: opts.period,
    per_page: String(Math.min(Number(opts.perPage) || 30, 100)),
  });
  const url = `https://api.hh.ru/vacancies?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 403) {
    throw new Error(
      '403 от hh.ru — он блокирует этот IP. Запусти с домашнего компьютера и ВЫКЛЮЧИ VPN (или поставь VPN на Россию).'
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((j) => ({
    url: j.alternate_url || '',
    company: clean(j.employer?.name),
    title: clean(j.name),
    location: clean(j.area?.name),
  }));
}

// ---------- сбор и дедуп ----------
const all = [];
const errors = [];
for (const q of queries) {
  try {
    const jobs = await searchHH(q);
    all.push(...jobs);
    console.log(`  «${q}»: найдено ${jobs.length}`);
  } catch (e) {
    errors.push(`«${q}»: ${e.message}`);
  }
}

// убираем дубли внутри результатов
const seen = new Set();
let jobs = all.filter((j) => {
  if (!j.url || seen.has(j.url)) return false;
  seen.add(j.url);
  return true;
});

// убираем то, что уже есть в pipeline.md
let pipelineText = existsSync(PIPELINE_PATH) ? readFileSync(PIPELINE_PATH, 'utf-8') : '';
const before = jobs.length;
jobs = jobs.filter((j) => !pipelineText.includes(j.url));
const skippedDup = before - jobs.length;

// ---------- вывод / запись ----------
if (errors.length) {
  console.log('\n⚠️  Проблемы:');
  errors.forEach((e) => console.log('   - ' + e));
}

if (jobs.length === 0) {
  console.log('\nНовых вакансий нет (всё уже в списке или поиск пустой).');
  process.exit(0);
}

const lines = jobs.map((j) => `- [ ] ${j.url} | ${j.company} | ${j.title} | ${j.location}`);

if (opts.dryRun) {
  console.log(`\n[dry-run] Нашёл ${jobs.length} новых вакансий (пропущено дублей: ${skippedDup}):\n`);
  console.log(lines.join('\n'));
  process.exit(0);
}

// вставляем под заголовок «## Pending»
if (!pipelineText.includes('## Pending')) {
  pipelineText =
    (pipelineText || '# Pipeline — Pending URLs\n') + '\n## Pending\n\n## Processed\n';
}
const marker = '## Pending';
const idx = pipelineText.indexOf(marker) + marker.length;
const nextSection = pipelineText.indexOf('\n## ', idx);
const insertAt = nextSection === -1 ? pipelineText.length : nextSection;
const block = '\n' + lines.join('\n') + '\n';
pipelineText = pipelineText.slice(0, insertAt) + block + pipelineText.slice(insertAt);
writeFileSync(PIPELINE_PATH, pipelineText, 'utf-8');

console.log(`\n✅ Добавил ${jobs.length} вакансий в ${PIPELINE_PATH} (пропущено дублей: ${skippedDup}).`);
console.log('Теперь запусти в career-ops:  /career-ops pipeline');
