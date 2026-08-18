#!/usr/bin/env bash
# deadtime installer for GitHub Copilot CLI -- wires a status line into
# Copilot CLI that shows the same content as the Claude Code version:
# quiet lines while you wait, occasional disclosed sponsor lines. Uses
# Copilot CLI's own statusLine.command setting -- nothing about your
# machine is patched.
#
# Heads up: statusLine.command is an experimental Copilot CLI feature
# (GitHub's own label, as of mid-2026) and its config shape could change.
# If this stops working after a Copilot CLI update, that's most likely
# why -- check https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
set -euo pipefail

SERVER="https://deadtime-server.bean-picker.workers.dev"
INSTALL_DIR="$HOME/.deadtime-client"

echo "deadtime: installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

curl -fsSL "$SERVER/copilot_statusline.py" -o "$INSTALL_DIR/copilot_statusline.py"

if ! python3 -c "import certifi" 2>/dev/null; then
  echo "deadtime: installing certifi (helps with HTTPS, not required)..."
  python3 -m pip install --quiet certifi 2>/dev/null \
    || python3 -m pip install --quiet --user certifi 2>/dev/null \
    || python3 -m pip install --quiet --break-system-packages certifi 2>/dev/null \
    || echo "deadtime: couldn't install certifi, continuing without it (copilot_statusline.py falls back automatically)"
fi

python3 - "$INSTALL_DIR/copilot_statusline.py" <<'PYEOF'
import json
import sys
from pathlib import Path

script_path = sys.argv[1]
settings_path = Path.home() / ".copilot" / "settings.json"
settings_path.parent.mkdir(exist_ok=True)

settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
settings["statusLine"] = {"type": "command", "command": f"python3 {script_path}"}
settings_path.write_text(json.dumps(settings, indent=2) + "\n")

print(f"deadtime: wired into {settings_path}")
PYEOF

echo "deadtime: installed. Restart Copilot CLI to see it live."
echo "deadtime: if you also use Claude Code, your earnings are shared under one install ID automatically."
echo "deadtime: to check earnings or register a payout email later, run:"
echo "  python3 $INSTALL_DIR/copilot_statusline.py --claim"
