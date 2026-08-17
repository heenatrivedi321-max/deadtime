#!/usr/bin/env python3
"""Claude Code status line -- thin client. Talks to the deadtime server for
content and impression tracking; keeps only a persistent anonymous install
ID locally. All billing/rotation logic lives server-side now, since the
server is the only trustworthy source of truth for impression counts.
"""
import json
import ssl
import sys
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


def fetch_line(install_id: str) -> str:
    url = f"{SERVER_URL}/line?id={install_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "deadtime-client/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=3, context=SSL_CONTEXT) as resp:
            data = json.loads(resp.read())
            return data["line"]
    except Exception:
        # server unreachable -- fail quiet and cheap, never break the terminal
        return FALLBACK_LINE


def main():
    try:
        sys.stdin.read()
    except Exception:
        pass
    install_id = get_install_id()
    print(fetch_line(install_id))


if __name__ == "__main__":
    main()
