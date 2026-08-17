#!/usr/bin/env python3
"""One-command installer: wires deadtime into Claude Code's statusLine setting
without hand-editing JSON. Safe to re-run -- won't duplicate the entry."""
import json
from pathlib import Path

SETTINGS = Path.home() / ".claude" / "settings.json"
COMMAND = f"python3 {Path.home()}/Documents/deadtime/statusline.py"


def main():
    SETTINGS.parent.mkdir(exist_ok=True)
    settings = json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}

    settings["statusLine"] = {"type": "command", "command": COMMAND}

    SETTINGS.write_text(json.dumps(settings, indent=2) + "\n")
    print(f"Installed. Wired into {SETTINGS}")
    print("Restart Claude Code (close and reopen your terminal tab) to see it live.")


if __name__ == "__main__":
    main()
