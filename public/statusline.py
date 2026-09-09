#!/usr/bin/env python3
"""Claude Code status line -- thin client. Talks to the deadtime server for
content and impression tracking; keeps only a persistent anonymous install
ID locally. All billing/rotation logic lives server-side now, since the
server is the only trustworthy source of truth for impression counts.
"""
import hashlib
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
    # certifi is a nice-to-have, not a hard requirement -- falls back to
    # the system's own certificate store, which is normally fine on both
    # macOS and Linux. Never let a missing package break the status line.
    SSL_CONTEXT = ssl.create_default_context()

SERVER_URL = "https://trymeanwhile.online"
INSTALL_ID_FILE = Path.home() / ".deadtime" / "install_id"
FALLBACK_LINE = "deadtime: agent working..."


def get_install_id() -> str:
    INSTALL_ID_FILE.parent.mkdir(exist_ok=True)
    if INSTALL_ID_FILE.exists():
        return INSTALL_ID_FILE.read_text().strip()
    new_id = str(uuid.uuid4())
    INSTALL_ID_FILE.write_text(new_id)
    try:
        # This ID is a real credential now -- it's what /register-payout
        # trusts to change where money goes. Default file permissions
        # (world-readable) would let any other local account on a shared
        # machine read it. Windows doesn't have this permission model, so
        # this is a no-op there rather than an error.
        INSTALL_ID_FILE.chmod(0o600)
    except Exception:
        pass
    return new_id


def read_session_state() -> dict:
    """Claude Code passes real session state as JSON on stdin every call --
    which event fired, plus session cost, token usage, and the working
    directory. A script pinging our endpoint on a timer has none of this;
    only a genuinely running Claude Code session does. Forwarding it lets
    the server tell real activity apart from a faked loop, instead of just
    trusting that every request represents a real moment on screen.

    cwd is hashed, not sent raw -- it's enough to detect "did the working
    directory change" without the server ever seeing an actual project
    path, consistent with never seeing your code or your conversation."""
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        payload = {}
    cwd = str(payload.get("workspace", {}).get("current_dir", "") or "")
    cwd_hash = hashlib.sha256(cwd.encode("utf-8")).hexdigest()[:16] if cwd else ""
    context = payload.get("context_window", {}) or {}
    tokens = int(context.get("total_input_tokens", 0) or 0) + int(context.get("total_output_tokens", 0) or 0)
    return {
        "event": str(payload.get("hook_event_name", "unknown")),
        "session_id": str(payload.get("session_id", "") or ""),
        "cost": float((payload.get("cost", {}) or {}).get("total_cost_usd", 0) or 0),
        "tokens": tokens,
        "cwd_hash": cwd_hash,
    }


def fetch_line(install_id: str, session: dict) -> str:
    params = urllib.parse.urlencode({
        "id": install_id,
        "event": session["event"],
        "sid": session["session_id"],
        "cost": session["cost"],
        "tok": session["tokens"],
        "cwd": session["cwd_hash"],
    })
    url = f"{SERVER_URL}/line?{params}"
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
        # server unreachable -- fail quiet and cheap, never break the terminal
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
    # Everything above this line only ever fails quiet and returns a
    # fallback value -- but get_install_id() touches the filesystem
    # (permission denied, read-only home dir, disk full are all real
    # possibilities out in the world), and that was never guarded. The
    # site's own promise is "never blocks or breaks your terminal" --
    # this makes that actually true instead of true-in-most-cases.
    try:
        session = read_session_state()
        install_id = get_install_id()
        print(fetch_line(install_id, session))
    except Exception:
        print(FALLBACK_LINE)


if __name__ == "__main__":
    main()
