#!/bin/bash
# Kumsal kanaryası — Mac mini'de gece koşusu (launchd: canary/install-local.sh kurar).
#
# Neden yerelde: akorlar.com Cloudflare'i GitHub'ın veri merkezi IP'lerini (URLSession dahil)
# engelliyor; ev bağlantısı geçiyor. GitHub iş akışı yedek olarak kalır.
# Akış: ağ yoksa sessizce çık → git pull → kontrol → kırıksa tamir → başarılı: commit + push,
# başarısız: issue aç (açık aynı başlıklı varsa yorum). Anahtar anahtarlıktan okunur
# (servis "kumsal-canary", hesap "anthropic"); dosyaya yazılmaz. Günlük ~/Library/Logs/kumsal-canary/.

set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/kumsal-canary"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/canary.log" 2>&1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "=== $(date '+%Y-%m-%d %H:%M:%S %Z')"

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

if node canary/check.mjs; then
  echo "Kırık yok."
  exit 0
fi

KEY="$(security find-generic-password -s kumsal-canary -a anthropic -w 2>/dev/null || true)"
OUT="$(ANTHROPIC_API_KEY="$KEY" node canary/fix.mjs)"
STATUS=$?
echo "$OUT"

if [ $STATUS -eq 0 ]; then
  SOURCE="$(echo "$OUT" | grep -o 'FIXED_SOURCE=.*' | cut -d= -f2)"
  git add rules.json
  if ! git diff --cached --quiet; then
    git commit -q -m "canary: ${SOURCE} seçicileri otomatik tazelendi (Mac mini)" && git push -q && echo "Tamir yayınlandı."
  fi
else
  SOURCE="$(echo "$OUT" | grep -o '^Kaynak: .*' | head -1 | cut -d' ' -f2)"
  TITLE="KANARYA: ${SOURCE:-kural} kırık, otomatik tamir başarısız"
  NUM="$(gh issue list --state open --search "in:title \"$TITLE\"" --json number --jq '.[0].number // empty' 2>/dev/null)"
  if [ -n "$NUM" ]; then
    echo "$OUT" | gh issue comment "$NUM" --body-file - && echo "Issue #$NUM'a yorum eklendi."
  else
    echo "$OUT" | gh issue create --title "$TITLE" --body-file - && echo "Issue açıldı."
  fi
fi
