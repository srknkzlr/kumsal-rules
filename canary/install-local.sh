#!/bin/bash
# Mac mini gece kanaryasını launchd'ye kurar (her gece 03:30, yerel saat). Tekrar çalıştırmak
# güvenli (eski kaydı değiştirir). Kaldırmak: launchctl bootout gui/$(id -u)/com.kumsal.canary
# && rm ~/Library/LaunchAgents/com.kumsal.canary.plist
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.kumsal.canary"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/kumsal-canary.log"
ENV_DIR="$HOME/.config/kumsal-canary"
chmod +x "$REPO_DIR/canary/run.sh"

# Gizliler dosyası (repo dışında; var olan dosyaya dokunulmaz).
mkdir -p "$ENV_DIR" && chmod 700 "$ENV_DIR"
if [ ! -f "$ENV_DIR/env" ]; then
  ( umask 077; printf 'ANTHROPIC_API_KEY=BURAYA_YAPISTIR\nNTFY_TOPIC=\nIMESSAGE_TO=\n' > "$ENV_DIR/env" )
fi
chmod 600 "$ENV_DIR/env"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$REPO_DIR/canary/run.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Kuruldu: $PLIST (her gece 03:30). Elle denemek: launchctl kickstart gui/$(id -u)/$LABEL"
if grep -q '^ANTHROPIC_API_KEY=\(BURAYA_YAPISTIR\)\{0,1\}$' "$ENV_DIR/env"; then
  echo "Anthropic anahtarı henüz girilmemiş: $ENV_DIR/env → ANTHROPIC_API_KEY=..."
fi
