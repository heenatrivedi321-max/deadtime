#!/usr/bin/env python3
"""The real server. Every installed client talks to this instead of reading
its own local files -- this is what makes it work for someone other than
the one machine it was built on.

Per-install state (current line, rotation timer, billing) lives here now,
keyed by an anonymous install_id the client generates once and keeps.
Same billable-impression rule as before: a line only counts once it's
been continuously shown for BILLABLE_THRESHOLD seconds -- enforced here,
server-side, since the server is the only place that can actually be
trusted as the source of truth (a client could lie about its own timer).
"""
import http.server
import json
import random
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from content import TIPS, SPONSORS

DATA_DIR = Path.home() / ".deadtime-server"
INSTALLS_FILE = DATA_DIR / "installs.json"
LEADS_FILE = DATA_DIR / "advertiser_leads.jsonl"

FILL_CEILING = 0.40
ROTATE_SECONDS = 20
BILLABLE_THRESHOLD = 10
CPM = 2.0
USER_SHARE = 0.5

_lock = threading.Lock()


def _ensure_dir():
    DATA_DIR.mkdir(exist_ok=True)


def load_installs() -> dict:
    _ensure_dir()
    if INSTALLS_FILE.exists():
        return json.loads(INSTALLS_FILE.read_text())
    return {}


def save_installs(installs: dict):
    _ensure_dir()
    INSTALLS_FILE.write_text(json.dumps(installs))


def default_install_state() -> dict:
    return {
        "total_calls": 0,
        "sponsor_calls": 0,
        "current_kind": None,
        "current_line": None,
        "line_started": 0.0,
        "billed_current": False,
    }


def sponsor_ratio(state: dict) -> float:
    if state["total_calls"] == 0:
        return 0.0
    return state["sponsor_calls"] / state["total_calls"]


def pick_line(state: dict):
    ratio = sponsor_ratio(state)
    show_sponsor = SPONSORS and ratio < FILL_CEILING and random.random() < FILL_CEILING
    if show_sponsor:
        return "sponsor", random.choice(SPONSORS)
    return "tip", random.choice(TIPS)


def handle_line_request(install_id: str) -> dict:
    with _lock:
        installs = load_installs()
        state = installs.get(install_id, default_install_state())
        now = time.time()

        if state["current_line"] is None or (now - state["line_started"]) >= ROTATE_SECONDS:
            kind, line = pick_line(state)
            state["current_kind"] = kind
            state["current_line"] = line
            state["line_started"] = now
            state["billed_current"] = False

        visible_for = now - state["line_started"]
        if not state["billed_current"] and visible_for >= BILLABLE_THRESHOLD:
            state["total_calls"] += 1
            if state["current_kind"] == "sponsor":
                state["sponsor_calls"] += 1
            state["billed_current"] = True

        installs[install_id] = state
        save_installs(installs)
        return {"line": state["current_line"], "kind": state["current_kind"]}


def handle_earnings_request(install_id: str) -> dict:
    with _lock:
        installs = load_installs()
        state = installs.get(install_id, default_install_state())
        revenue = state["sponsor_calls"] * (CPM / 1000)
        return {
            "total_calls": state["total_calls"],
            "sponsor_calls": state["sponsor_calls"],
            "sponsor_ratio": sponsor_ratio(state),
            "gross_revenue": revenue,
            "user_earnings": revenue * USER_SHARE,
        }


def handle_network_stats() -> dict:
    with _lock:
        installs = load_installs()
        total = sum(s["total_calls"] for s in installs.values())
        sponsor = sum(s["sponsor_calls"] for s in installs.values())
        return {
            "installs": len(installs),
            "total_calls": total,
            "sponsor_calls": sponsor,
            "sponsor_ratio": (sponsor / total) if total else 0.0,
        }


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, body: dict, status=200):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        install_id = (qs.get("id") or [None])[0]

        if parsed.path == "/line":
            if not install_id:
                return self._json({"error": "missing ?id="}, 400)
            return self._json(handle_line_request(install_id))

        if parsed.path == "/earnings":
            if not install_id:
                return self._json({"error": "missing ?id="}, 400)
            return self._json(handle_earnings_request(install_id))

        if parsed.path == "/network-stats":
            return self._json(handle_network_stats())

        self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/advertiser-lead":
            return self._json({"error": "not found"}, 404)
        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)

        required = ("line", "url", "company", "email")
        if not all(data.get(k) for k in required):
            return self._json({"error": "missing fields"}, 400)

        _ensure_dir()
        data["ts"] = time.time()
        with open(LEADS_FILE, "a") as f:
            f.write(json.dumps(data) + "\n")
        self._json({"ok": True})

    def log_message(self, fmt, *args):
        pass  # keep the console clean; real logging can come later


if __name__ == "__main__":
    port = 8500
    print(f"deadtime backend running on http://localhost:{port}")
    print(f"install data: {INSTALLS_FILE}")
    http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
