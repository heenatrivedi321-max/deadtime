#!/usr/bin/env bash
# deadtime installer -- wires a status line into Claude Code that shows
# useful tips and occasional disclosed sponsor lines. Nothing about your
# machine is patched; this uses Claude Code's own supported statusLine
# setting.
set -euo pipefail

SERVER="https://deadtime-server.bean-picker.workers.dev"
INSTALL_DIR="$HOME/.deadtime-client"
STATE_DIR="$HOME/.deadtime"

echo "deadtime: installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Generate the real install ID right here, on the device, the moment an
# install actually happens -- not guessed ahead of time by the website.
# Only if one doesn't already exist, so re-running this script never
# clobbers an existing install's history with a fresh random ID.
mkdir -p "$STATE_DIR"
if [ ! -f "$STATE_DIR/install_id" ]; then
  python3 -c "import uuid; print(uuid.uuid4())" > "$STATE_DIR/install_id"
  chmod 600 "$STATE_DIR/install_id" 2>/dev/null || true
fi
INSTALL_ID="$(cat "$STATE_DIR/install_id")"

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

# Open the browser straight to the claim page -- same pattern as
# `gh auth login` / `vercel login` / `wrangler login`. This is the only
# honest way for the website to know an install actually happened: it
# fires because this script really did just write a real install ID,
# not because someone merely copied a command. Never let a headless/
# remote/no-display environment (SSH, CI) fail the install over this.
CLAIM_URL="$SERVER/claim.html?id=$INSTALL_ID"
if command -v open >/dev/null 2>&1; then
  open "$CLAIM_URL" >/dev/null 2>&1 || echo "deadtime: open this to see your live balance: $CLAIM_URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$CLAIM_URL" >/dev/null 2>&1 || echo "deadtime: open this to see your live balance: $CLAIM_URL"
else
  echo "deadtime: open this to see your live balance: $CLAIM_URL"
fi
