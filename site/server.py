#!/usr/bin/env python3
"""Tiny local server: serves advertiser.html and catches form submissions into
a real JSON file. No payment processing wired up yet -- honestly labeled as
'reserve early access' until a real payment gateway is added."""
import http.server
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from ledger import load_state, current_sponsor_ratio

SITE_DIR = Path(__file__).parent
LEADS_FILE = Path.home() / ".deadtime" / "advertiser_leads.jsonl"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

    def do_GET(self):
        if self.path == "/stats":
            state = load_state()
            body = json.dumps({
                "total_calls": state["total_calls"],
                "sponsor_ratio": current_sponsor_ratio(state),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/":
            self.path = "/install.html"
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        if self.path != "/submit":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self.send_error(400, "bad json")
            return

        required = ("line", "url", "company", "email")
        if not all(data.get(k) for k in required):
            self.send_error(400, "missing fields")
            return

        LEADS_FILE.parent.mkdir(exist_ok=True)
        data["ts"] = time.time()
        with open(LEADS_FILE, "a") as f:
            f.write(json.dumps(data) + "\n")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok": true}')


if __name__ == "__main__":
    port = 8420
    print(f"deadtime advertiser page: http://localhost:{port}")
    print(f"leads saved to: {LEADS_FILE}")
    http.server.HTTPServer(("localhost", port), Handler).serve_forever()
