#!/usr/bin/env bash
# Дотискає player-photos у WebP.
#
# Навіщо: фото гравців з FPL — це 220x280 PNG до 273 KB на аватарку розміром
# із шестикутник. У серпні 2026 вони вибрали квоту egress free-плану Supabase
# (1.1 GB/добу, з них ~1 GB — бот-ферма на Azure, що рендерила goatapp.club).
# cwebp -q 82 дає ×27 на найважчих файлах.
#
# api/sync-photos.js кладе нові фото під ім'ям .webp, але PNG-байтами
# (на Vercel немає cwebp). Цей скрипт знаходить такі файли і дотискає їх.
#
# Запуск: source ~/.config/goat_supabase.env && scripts/recompress-photos.sh
# Ідемпотентний: справжні WebP пропускає.
set -euo pipefail

: "${SUPABASE_SERVICE_ROLE_KEY:?run: source ~/.config/goat_supabase.env}"
: "${SUPABASE_URL:?run: source ~/.config/goat_supabase.env}"
command -v cwebp >/dev/null || { echo "потрібен cwebp: brew install webp"; exit 1; }

BUCKET=player-photos
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
converted=0; skipped=0; failed=0

curl -sS -X POST "$SUPABASE_URL/storage/v1/object/list/$BUCKET" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"prefix":"","limit":10000}' \
  | python3 -c "import sys,json;[print(f['name']) for f in json.load(sys.stdin) if f['name'].endswith('.webp')]" > "$WORK/list.txt"

while read -r n; do
  curl -sS -f -o "$WORK/f" "$SUPABASE_URL/storage/v1/object/public/$BUCKET/$n" || { echo "DOWNLOAD FAIL $n"; failed=$((failed+1)); continue; }
  # справжній WebP починається з RIFF....WEBP — такий не чіпаємо
  if head -c 12 "$WORK/f" | grep -q WEBP; then skipped=$((skipped+1)); continue; fi
  cwebp -quiet -q 82 "$WORK/f" -o "$WORK/out.webp" || { echo "CONVERT FAIL $n"; failed=$((failed+1)); continue; }
  [ -s "$WORK/out.webp" ] || { echo "EMPTY $n"; failed=$((failed+1)); continue; }
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$n" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "x-upsert: true" -F "cacheControl=2592000" -F "file=@$WORK/out.webp;type=image/webp")
  if [ "$code" = 200 ]; then converted=$((converted+1)); else echo "UPLOAD FAIL $n $code"; failed=$((failed+1)); fi
done < "$WORK/list.txt"

echo "дотиснуто: $converted, вже webp: $skipped, помилок: $failed"
[ "$failed" -eq 0 ]
