#!/usr/bin/env python3
"""
fetch_page.py — открыть страницу вакансии по ссылке «стелс»-способом и вернуть текст.

curl_cffi прикидывается настоящим Chrome (по TLS-отпечатку), поэтому берёт часть
страниц, которые не открываются обычным запросом. Затем markitdown превращает
HTML в чистый markdown.

Когда применять: пользователь кинул ссылку на вакансию, а обычный фетч её не взял
(защита/JS). Это запасной путь, не основной.
⚠️ JS-рендеринг не выполняется — если весь текст подгружается скриптами, страница
может прийти полупустой. Тогда попроси пользователя скопировать текст вакансии.

Запуск:  ./.venv/bin/python sources/fetch_page.py "<url>"
"""

import io
import sys

if len(sys.argv) < 2:
    print("Использование: fetch_page.py <url вакансии>", file=sys.stderr)
    sys.exit(1)

url = sys.argv[1]
try:
    from curl_cffi import requests
    from markitdown import MarkItDown

    r = requests.get(url, impersonate="chrome", timeout=25)
    if r.status_code >= 400:
        print(f"⚠️ HTTP {r.status_code} — страница могла не открыться (защита/битая ссылка)", file=sys.stderr)

    md = MarkItDown().convert_stream(io.BytesIO(r.content), file_extension=".html")
    text = (md.text_content or "").strip()
    if len(text) < 200:
        print("⚠️ Текста мало — возможно, контент грузится через JS. Попроси скопировать вручную.", file=sys.stderr)
    print(text)
except Exception as e:
    print(f"Не удалось открыть страницу: {e}", file=sys.stderr)
    sys.exit(1)
