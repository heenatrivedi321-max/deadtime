#!/usr/bin/env python3
"""Claude Code status line -- thin client. Talks to the deadtime server for
content and impression tracking; keeps only a persistent anonymous install
ID locally. All billing/rotation logic lives server-side now, since the
server is the only trustworthy source of truth for impression counts.
"""
import json
import ssl
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import certifi

SERVER_URL = "https://deadtime-server.bean-picker.workers.dev"
INSTALL_ID_FILE = Path.home() / ".deadtime" / "install_id"
FALLBACK_LINE = "deadtime: agent working..."
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def get_install_id() -> str:
    INSTALL_ID_FILE.parent.mkdir(exist_ok=True)
    if INSTALL_ID_FILE.exists():
        return INSTALL_ID_FILE.read_text().strip()
    new_id = str(uuid.uuid4())
    INSTALL_ID_FILE.write_text(new_id)
    return new_id


def read_event_name() -> str:
    """Claude Code passes session state as JSON on stdin, including which
    real event triggered this call (new assistant message, session start,
    /compact, etc.) -- we forward that so billing is tied to genuine
    activity, not a guess."""
    try:
        payload = json.loads(sys.stdin.read())
        return str(payload.get("hook_event_name", "unknown"))
    except Exception:
        return "unknown"


def fetch_line(install_id: str, event_name: str) -> str:
    url = f"{SERVER_URL}/line?id={install_id}&event={urllib.parse.quote(event_name)}"
    req = urllib.request.Request(url, headers={"User-Agent": "deadtime-client/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=3, context=SSL_CONTEXT) as resp:
            data = json.loads(resp.read())
            return data["line"]
    except Exception:
        # server unreachable -- fail quiet and cheap, never break the terminal
        return FALLBACK_LINE


def main():
    event_name = read_event_name()
    install_id = get_install_id()
    print(fetch_line(install_id, event_name))


if __name__ == "__main__":
    main()
