#!/usr/bin/env python3
"""
jobspy_search.py — широкий поиск вакансий через JobSpy и добавление их
во «входящий список» (data/pipeline.md).

Источник «широкого пруда»: LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter —
компании всех размеров и сфер, не только funded-стартапы.

После запуска оцени найденное:  /career-ops pipeline

ЗАПУСКАТЬ через venv проекта:
  ./.venv/bin/python sources/jobspy_search.py "python developer" "telegram bot"

Примеры:
  ./.venv/bin/python sources/jobspy_search.py "frontend developer" --location "Remote" --remote
  ./.venv/bin/python sources/jobspy_search.py "no-code automation" --sites indeed,google --results 30
  ./.venv/bin/python sources/jobspy_search.py "react" --hours-old 72 --dry-run

Параметры:
  --location LOC    локация для поиска (по умолчанию "Remote")
  --remote          искать только удалённые
  --sites LIST      площадки через запятую (по умолчанию indeed,google,glassdoor,zip_recruiter)
                    можно добавить linkedin (но он чаще лимитирует/блокирует)
  --results N       сколько вакансий на запрос на площадку (по умолчанию 20)
  --hours-old N     не старше N часов (по умолчанию 168 = 7 дней)
  --country COUNTRY страна для Indeed/Glassdoor (по умолчанию "USA"; для РФ толку мало — там hh.ru)
  --dry-run         показать, не записывать в pipeline.md
"""

import argparse
import sys
from pathlib import Path

PIPELINE_PATH = Path(__file__).resolve().parent.parent / "data" / "pipeline.md"
# По умолчанию — только устойчивые к VPN площадки (Indeed, LinkedIn).
# Glassdoor/Google/ZipRecruiter блокируют скрапинг через VPN (403/пусто) — их можно
# добавить вручную через --sites, но по умолчанию не дёргаем, чтобы не мусорить нулями.
# Широту добираем бордами (Wellfound/RemoteOK/WWR через WebSearch) и компаниями (ATS API).
DEFAULT_SITES = ["indeed", "linkedin"]


def clean(s):
    """Убираем символы, ломающие формат pipeline (| и переносы); NaN → пусто."""
    import math
    if s is None:
        return ""
    if isinstance(s, float) and math.isnan(s):
        return ""
    s = str(s)
    if s.strip().lower() == "nan":
        return ""
    return s.replace("|", "/").replace("\n", " ").strip()


def read_pipeline():
    return PIPELINE_PATH.read_text(encoding="utf-8") if PIPELINE_PATH.exists() else ""


def write_to_pipeline(lines):
    text = read_pipeline()
    if "## Pending" not in text:
        text = (text or "# Pipeline — Pending URLs\n") + "\n## Pending\n\n## Processed\n"
    marker = "## Pending"
    idx = text.index(marker) + len(marker)
    nxt = text.find("\n## ", idx)
    insert_at = len(text) if nxt == -1 else nxt
    block = "\n" + "\n".join(lines) + "\n"
    text = text[:insert_at] + block + text[insert_at:]
    PIPELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PIPELINE_PATH.write_text(text, encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description="Широкий поиск вакансий через JobSpy")
    p.add_argument("queries", nargs="+", help="Поисковые запросы")
    p.add_argument("--location", default="Remote")
    p.add_argument("--remote", action="store_true")
    p.add_argument("--sites", default=",".join(DEFAULT_SITES))
    p.add_argument("--results", type=int, default=20)
    p.add_argument("--hours-old", type=int, default=168)
    p.add_argument("--country", default="USA")
    p.add_argument("--job-type", default=None,
                   choices=["fulltime", "parttime", "contract", "internship"],
                   help="тип занятости (contract ≈ фриланс/проект)")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    try:
        from jobspy import scrape_jobs
    except ImportError:
        print("JobSpy не установлен. Поставь: ./.venv/bin/pip install python-jobspy", file=sys.stderr)
        sys.exit(1)

    sites = [s.strip() for s in args.sites.split(",") if s.strip()]
    all_rows = []
    errors = []

    for q in args.queries:
        try:
            df = scrape_jobs(
                site_name=sites,
                search_term=q,
                location=args.location,
                results_wanted=args.results,
                hours_old=args.hours_old,
                is_remote=args.remote,
                country_indeed=args.country,
                job_type=args.job_type,
            )
            if df is not None and not df.empty:
                all_rows.append(df)
                print(f"  «{q}»: найдено {len(df)}")
            else:
                print(f"  «{q}»: 0")
        except Exception as e:
            errors.append(f"«{q}»: {e}")

    if errors:
        print("\n⚠️  Проблемы (часть площадок могла заблокировать серверный IP — запусти с домашнего компа):", file=sys.stderr)
        for e in errors:
            print("   -", e, file=sys.stderr)

    if not all_rows:
        print("\nНичего не найдено.")
        return

    import pandas as pd
    df = pd.concat(all_rows, ignore_index=True)

    # Дедуп по ссылке + против того, что уже в pipeline.md
    existing = read_pipeline()
    seen = set()
    lines = []
    for _, r in df.iterrows():
        url = clean(r.get("job_url") or r.get("job_url_direct"))
        if not url or url in seen or url in existing:
            continue
        seen.add(url)
        company = clean(r.get("company"))
        title = clean(r.get("title"))
        location = clean(r.get("location"))
        lines.append(f"- [ ] {url} | {company} | {title} | {location}")

    if not lines:
        print("\nНовых вакансий нет (всё уже в списке).")
        return

    if args.dry_run:
        print(f"\n[dry-run] {len(lines)} новых вакансий:\n")
        print("\n".join(lines))
        return

    write_to_pipeline(lines)
    print(f"\n✅ Добавил {len(lines)} вакансий в {PIPELINE_PATH}")
    print("Теперь оцени их:  /career-ops pipeline")


if __name__ == "__main__":
    main()
