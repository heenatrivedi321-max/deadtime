#!/usr/bin/env python3
"""GitHub Copilot CLI status line -- thin client, port of statusline.py.
Talks to the deadtime server for content and impression tracking; keeps
only a persistent anonymous install ID locally. Shares that install ID
file with the Claude Code adapter on purpose: earnings from every client
you use accumulate against one identity, one payout.

Copilot CLI's statusLine.command hook is experimental (GitHub's own
label, as of mid-2026) -- the JSON shape it pipes to stdin could change
under us without notice. Every field read from stdin is read
defensively for that reason.
"""
import json
import ssl
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

SERVER_URL = "https://deadtime-server.bean-picker.workers.dev"
INSTALL_ID_FILE = Path.home() / ".deadtime" / "install_id"
FALLBACK_LINE = "deadtime: agent working..."


def get_install_id() -> str:
    INSTALL_ID_FILE.parent.mkdir(exist_ok=True)
    if INSTALL_ID_FILE.exists():
        return INSTALL_ID_FILE.read_text().strip()
    new_id = str(uuid.uuid4())
    INSTALL_ID_FILE.write_text(new_id)
    try:
        INSTALL_ID_FILE.chmod(0o600)
    except Exception:
        pass
    return new_id


def read_event_name() -> str:
    """Copilot CLI pipes a session-state JSON payload on stdin after each
    model response (no equivalent to Claude Code's hook_event_name) --
    we forward the session_id if present so the server's last-seen-event
    field is at least informative, but nothing billing-relevant depends
    on this value."""
    try:
        payload = json.loads(sys.stdin.read())
        session_id = payload.get("session_id")
        return f"copilot:{session_id}" if session_id else "copilot:response"
    except Exception:
        return "copilot:unknown"


def fetch_line(install_id: str, event_name: str) -> str:
    url = f"{SERVER_URL}/line?id={install_id}&event={urllib.parse.quote(event_name)}"
    req = urllib.request.Request(url, headers={"User-Agent": "deadtime-client/1.0"})
    try:
        # 6s, not 3s: cold-starting a fresh python3 process and loading the
        # certifi cert bundle can itself take close to 2s before the request
        # even goes out -- measured live, not a guess. A short timeout here
        # just means falling back to filler more often than necessary.
        with urllib.request.urlopen(req, timeout=6, context=SSL_CONTEXT) as resp:
            data = json.loads(resp.read())
            return data["line"]
    except Exception:
        return FALLBACK_LINE


def fetch_earnings(install_id: str) -> dict | None:
    url = f"{SERVER_URL}/earnings?id={install_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "deadtime-client/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=5, context=SSL_CONTEXT) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def print_claim_info():
    install_id = get_install_id()
    earnings = fetch_earnings(install_id)
    claim_url = f"{SERVER_URL}/claim?id={install_id}"

    print("meanwhile -- your account")
    print(f"  ID:      {install_id}")
    if earnings:
        print(f"  earned:  ${earnings['user_earnings']:.2f}")
        print(f"  shown:   {earnings['total_calls']} lines ({earnings['sponsor_calls']} sponsored)")
    else:
        print("  earned:  (couldn't reach server -- check your connection)")
    print()
    print(f"  register a payout email: {claim_url}")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--claim":
        print_claim_info()
        return
    try:
        event_name = read_event_name()
        install_id = get_install_id()
        print(fetch_line(install_id, event_name))
    except Exception:
        print(FALLBACK_LINE)


if __name__ == "__main__":
    main()
