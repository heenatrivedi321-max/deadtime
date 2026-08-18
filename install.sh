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
  echo "deadtime: installing certifi (helps with HTTPS, not required)..."
  # Modern Python installs (Homebrew, Debian 12+, Ubuntu 23+) often block a
  # plain "pip install" by default (PEP 668). Try a few real fallbacks, but
  # never let this step take down the whole install -- statusline.py works
  # fine without certifi too, just falls back to the system's own
  # certificate store instead of a bundled one.
  python3 -m pip install --quiet certifi 2>/dev/null \
    || python3 -m pip install --quiet --user certifi 2>/dev/null \
    || python3 -m pip install --quiet --break-system-packages certifi 2>/dev/null \
    || echo "deadtime: couldn't install certifi, continuing without it (statusline.py falls back automatically)"
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
