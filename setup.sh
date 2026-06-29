#!/usr/bin/env bash
# JobForge — установщик «в одну команду».
# Запуск:  bash setup.sh
set -e

echo "🔨 JobForge — установка..."

# --- проверки ---
command -v node >/dev/null 2>&1 || { echo "❌ Нужен Node.js — поставь с https://nodejs.org"; exit 1; }
PY=""
for c in python3.13 python3.12 python3.11 python3.10; do
  command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }
done
if [ -z "$PY" ]; then
  echo "⚠️  Не нашёл Python 3.10+ (нужен для JobSpy)."
  echo "   Поставь: brew install python@3.11   — и запусти setup.sh снова."
  echo "   (Пока продолжу без JobSpy — остальной поиск работать будет.)"
fi

# --- 1) Node-зависимости (движок + Playwright для PDF) ---
echo "1/4 ⏳ Node-зависимости..."
npm install

# --- 2) Python-окружение для JobSpy ---
if [ -n "$PY" ]; then
  echo "2/4 ⏳ Python-окружение (JobSpy)..."
  "$PY" -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  # python-jobspy — поиск; markitdown — парсинг резюме PDF/Word; curl_cffi — стелс-фетч страниц
  ./.venv/bin/pip install -q python-jobspy "markitdown[pdf,docx]" curl_cffi
else
  echo "2/4 ⏭  Пропускаю JobSpy (нет Python 3.10+)"
fi

# --- 3) Конфиги по умолчанию (если их ещё нет) ---
echo "3/4 ⏳ Конфиги по умолчанию..."
[ -f config/profile.yml ]   || cp config/profile.example.yml config/profile.yml 2>/dev/null || true
[ -f portals.yml ]          || cp templates/portals.example.yml portals.yml 2>/dev/null || true
[ -f modes/_profile.md ]    || cp modes/_profile.template.md modes/_profile.md 2>/dev/null || true

# --- 4) Проверка ---
echo "4/4 🩺 Проверка..."
node doctor.mjs || true

echo ""
echo "✅ Готово! Открой папку JobForge в Claude и напиши:  настрой JobForge"
