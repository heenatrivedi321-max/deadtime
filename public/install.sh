#!/usr/bin/env bash
# deadtime installer -- wires a status line into Claude Code that shows
# useful tips and occasional disclosed sponsor lines. Nothing about your
# machine is patched; this uses Claude Code's own supported statusLine
# setting.
set -euo pipefail

SERVER="https://deadtime-server.bean-picker.workers.dev"
INSTALL_DIR="$HOME/.deadtime-client"

echo "deadtime: installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

curl -fsSL "$SERVER/statusline.py" -o "$INSTALL_DIR/statusline.py"

if ! python3 -c "import certifi" 2>/dev/null; then
  echo "deadtime: installing certifi (needed for HTTPS)..."
  python3 -m pip install --quiet certifi
fi

python3 - "$INSTALL_DIR/statusline.py" <<'PYEOF'
import json
import sys
from pathlib import Path

script_path = sys.argv[1]
settings_path = Path.home() / ".claude" / "settings.json"
settings_path.parent.mkdir(exist_ok=True)

settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
settings["statusLine"] = {"type": "command", "command": f"python3 {script_path}"}
settings_path.write_text(json.dumps(settings, indent=2) + "\n")

print(f"deadtime: wired into {settings_path}")
PYEOF

echo "deadtime: installed. Restart Claude Code (close and reopen your terminal) to see it live."
echo "deadtime: to check earnings or register a payout email later, run:"
echo "  python3 $INSTALL_DIR/statusline.py --claim"
