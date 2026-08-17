"""Append-only local ledger. Every impression is logged here -- this file is
the only source of truth for counts, nothing gets hand-edited into a dashboard.
"""
import json
import time
from pathlib import Path

LEDGER_DIR = Path.home() / ".deadtime"
LEDGER_FILE = LEDGER_DIR / "ledger.jsonl"
STATE_FILE = LEDGER_DIR / "state.json"

CPM = 2.0  # placeholder rate until real advertisers exist
USER_SHARE = 0.5


def _ensure_dir():
    LEDGER_DIR.mkdir(exist_ok=True)


def record(kind: str, line: str):
    _ensure_dir()
    entry = {"ts": time.time(), "kind": kind, "line": line}
    with open(LEDGER_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def load_state() -> dict:
    _ensure_dir()
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text())
        state.setdefault("current_kind", None)
        state.setdefault("current_line", None)
        state.setdefault("line_started", 0.0)
        state.setdefault("billed_current", False)
        return state
    return {
        "total_calls": 0,       # billable impressions only, not raw script invocations
        "sponsor_calls": 0,
        "current_kind": None,
        "current_line": None,
        "line_started": 0.0,
        "billed_current": False,
    }


def save_state(state: dict):
    _ensure_dir()
    STATE_FILE.write_text(json.dumps(state))


def current_sponsor_ratio(state: dict) -> float:
    if state["total_calls"] == 0:
        return 0.0
    return state["sponsor_calls"] / state["total_calls"]


def earnings_summary() -> dict:
    state = load_state()
    revenue = state["sponsor_calls"] * (CPM / 1000)
    return {
        "total_calls": state["total_calls"],
        "sponsor_calls": state["sponsor_calls"],
        "sponsor_ratio": current_sponsor_ratio(state),
        "gross_revenue": revenue,
        "user_earnings": revenue * USER_SHARE,
    }
