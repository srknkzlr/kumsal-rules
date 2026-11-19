#!/bin/bash
# Mac mini gece kanaryasını launchd'ye kurar (her gece 03:00, yerel saat). Tekrar çalıştırmak
# güvenli (eski kaydı değiştirir). Kaldırmak: launchctl bootout gui/$(id -u)/com.kumsal.canary
# && rm ~/Library/LaunchAgents/com.kumsal.canary.plist
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.kumsal.canary"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
chmod +x "$REPO_DIR/canary/run-local.sh"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$REPO_DIR/canary/run-local.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Kuruldu: $PLIST (her gece 03:00). Elle denemek: launchctl kickstart gui/$(id -u)/$LABEL"
if ! security find-generic-password -s kumsal-canary -a anthropic >/dev/null 2>&1; then
  echo "Anthropic anahtarı anahtarlıkta yok. Eklemek için:"
  echo "  security add-generic-password -U -s kumsal-canary -a anthropic -w"
fi
