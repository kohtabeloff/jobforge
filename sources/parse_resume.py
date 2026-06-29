#!/usr/bin/env python3
"""
parse_resume.py — разобрать файл резюме (PDF / Word / др.) в markdown.

Используется на этапе настройки (/setup), когда человек даёт резюме файлом,
а не текстом. Печатает чистый markdown в stdout.

Запуск:  ./.venv/bin/python sources/parse_resume.py /путь/к/резюме.pdf
"""

import sys

if len(sys.argv) < 2:
    print("Использование: parse_resume.py <путь к файлу резюме (PDF/DOCX/...)>", file=sys.stderr)
    sys.exit(1)

path = sys.argv[1]
try:
    from markitdown import MarkItDown
    result = MarkItDown().convert(path)
    text = (result.text_content or "").strip()
    if not text:
        print("Файл открылся, но текста не нашлось (возможно, это скан-картинка).", file=sys.stderr)
        sys.exit(2)
    print(text)
except FileNotFoundError:
    print(f"Файл не найден: {path}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Не удалось разобрать файл: {e}", file=sys.stderr)
    sys.exit(1)
