#!/bin/bash
# Kumsal kanaryası — Mac mini'de gece koşusu (launchd, 03:30; canary/install-local.sh kurar).
#
# Neden yerelde: akorlar.com Cloudflare'i GitHub'ın veri merkezi IP'lerini engelliyor; ev
# bağlantısı geçiyor. GitHub iş akışı yalnız elle tetikleme için durur.
# Akış: ağ yoksa sessizce çık → git pull → kontrol → kırıksa tamir (doğrulama kapısı fix.mjs'te)
# → geçti: rules.json commit + push, 🟢 bildirim; geçmedi: push YOK, 🔴 bildirim + issue.
# Olaysız gecede hiçbir bildirim yok.
# Gizliler: ~/.config/kumsal-canary/env (chmod 600; ANTHROPIC_API_KEY, NTFY_TOPIC) — repoya girmez.
# Günlük: ~/Library/Logs/kumsal-canary.log

set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/Library/Logs/kumsal-canary.log"
ENV_FILE="$HOME/.config/kumsal-canary/env"
exec >>"$LOG" 2>&1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "=== $(date '+%Y-%m-%d %H:%M:%S %Z')"

ANTHROPIC_API_KEY=""
NTFY_TOPIC=""
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
[ "$ANTHROPIC_API_KEY" = "BURAYA_YAPISTIR" ] && ANTHROPIC_API_KEY=""

notify() {  # tek satır; konu tanımlı değilse sessiz
  [ -n "$NTFY_TOPIC" ] || return 0
  curl -s -m 15 -H "Title: Kumsal kanarya" -d "$1" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null \
    || echo "ntfy bildirimi gönderilemedi."
}

# Ağ yoksa yanlış alarm verme.
if [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://github.com)" != "200" ]; then
  echo "Ağ yok; koşu atlandı."
  exit 0
fi

cd "$REPO_DIR" || exit 1
git pull --ff-only -q || { echo "git pull başarısız; koşu atlandı."; exit 1; }
npm ci --silent --no-audit --no-fund || { echo "npm ci başarısız."; exit 1; }
if [ ! -x canary/bin/fetch ] || [ canary/fetch.swift -nt canary/bin/fetch ]; then
  mkdir -p canary/bin && swiftc -O canary/fetch.swift -o canary/bin/fetch || { echo "getirici derlenemedi."; exit 1; }
fi
# Çizici (WKWebView): akorlab tür listesi istemcide çiziliyor. Derlenemezse o kontrol "belirsiz" kalır.
if [ ! -x canary/bin/render ] || [ canary/render.swift -nt canary/bin/render ]; then
  swiftc -O canary/render.swift -o canary/bin/render || echo "çizici derlenemedi (quickstart.akorlab belirsiz kalır)."
fi

CHECK_OUT="$(node canary/check.mjs 2>&1)"
CHECK_STATUS=$?
echo "$CHECK_OUT"
if [ $CHECK_STATUS -eq 0 ]; then
  echo "Kırık yok."
  exit 0
fi

if [ -n "$ANTHROPIC_API_KEY" ]; then
  OUT="$(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" node canary/fix.mjs)"
  STATUS=$?
else
  OUT="$(printf 'Otomatik tamir atlandı: ANTHROPIC_API_KEY tanımlı değil (%s).\n\n%s' "$ENV_FILE" "$CHECK_OUT")"
  STATUS=2
fi
echo "$OUT"

if [ $STATUS -eq 0 ]; then
  SOURCE="$(echo "$OUT" | grep -o 'FIXED_SOURCE=.*' | cut -d= -f2)"
  git add rules.json
  if git diff --cached --quiet; then
    echo "Tamir değişiklik üretmedi."
  elif git commit -q -m "canary: ${SOURCE} seçicileri otomatik tazelendi" && git push -q; then
    echo "Tamir yayınlandı."
    notify "🟢 ${SOURCE} seçicileri tamir edildi ve yayınlandı"
  else
    echo "Tamir commit/push edilemedi."
    notify "🔴 ${SOURCE} tamir edildi ama push edilemedi — Mac mini'ye bak"
  fi
  exit 0
fi

# Tamir edilemedi: fix.mjs hiçbir şey yazmadı, push yok.
SOURCE="$(echo "$OUT" | grep -o '^Kaynak: .*' | head -1 | cut -d' ' -f2)"
[ -n "$SOURCE" ] || SOURCE="$(echo "$CHECK_OUT" | grep -m1 '^✗' | sed -E 's/^✗ ([^:]+):.*/\1/')"
notify "🔴 ${SOURCE:-kural} kırık, tamir edilemedi"
if command -v gh >/dev/null 2>&1; then
  TITLE="KANARYA: ${SOURCE:-kural} kırık, otomatik tamir başarısız"
  NUM="$(gh issue list --state open --search "in:title \"$TITLE\"" --json number --jq '.[0].number // empty' 2>/dev/null)"
  if [ -n "$NUM" ]; then
    echo "$OUT" | gh issue comment "$NUM" --body-file - && echo "Issue #$NUM'a yorum eklendi."
  else
    echo "$OUT" | gh issue create --title "$TITLE" --body-file - && echo "Issue açıldı."
  fi
fi
exit 1
