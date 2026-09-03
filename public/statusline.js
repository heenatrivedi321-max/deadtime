#!/usr/bin/env node
// Claude Code status line -- Node port of statusline.py. Node is already
// guaranteed present (this is installed via `npx trymeanwhile`, which can't
// run without it), so this removes the separate hard Python dependency that
// used to stop the whole install cold for anyone without python3/python/py
// on PATH. Same server contract, same install ID file, same fail-quiet
// behavior -- existing installs still wired to statusline.py keep working
// unchanged; this is only what new installs get wired to.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const SERVER_URL = "https://trymeanwhile.online";
const INSTALL_ID_FILE = path.join(os.homedir(), ".deadtime", "install_id");
const FALLBACK_LINE = "deadtime: agent working...";

function getInstallId() {
  fs.mkdirSync(path.dirname(INSTALL_ID_FILE), { recursive: true });
  if (fs.existsSync(INSTALL_ID_FILE)) {
    return fs.readFileSync(INSTALL_ID_FILE, "utf8").trim();
  }
  const id = crypto.randomUUID();
  // This ID is a real credential -- it's what /register-payout trusts to
  // change where money goes. mode 0o600 so no other local account on a
  // shared machine can read it (no-op on Windows, which has no such model).
  fs.writeFileSync(INSTALL_ID_FILE, id, { mode: 0o600 });
  try { fs.chmodSync(INSTALL_ID_FILE, 0o600); } catch {}
  return id;
}

// Claude Code pipes real session state as JSON on stdin every call -- which
// event fired, plus session cost, token usage, and the working directory.
// A script pinging our endpoint on a timer has none of this; only a
// genuinely running Claude Code session does. Forwarding it lets the server
// tell real activity apart from a faked loop.
//
// cwd is hashed, not sent raw -- enough to detect "did the working
// directory change" without the server ever seeing an actual project path.
function readSessionState() {
  let payload = {};
  try {
    const raw = fs.readFileSync(0, "utf8");
    payload = JSON.parse(raw);
  } catch {}
  const cwd = String((payload.workspace && payload.workspace.current_dir) || "");
  const cwdHash = cwd ? crypto.createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, 16) : "";
  const context = payload.context_window || {};
  const tokens = (Number(context.total_input_tokens) || 0) + (Number(context.total_output_tokens) || 0);
  return {
    event: String(payload.hook_event_name || "unknown"),
    session_id: String(payload.session_id || ""),
    cost: Number((payload.cost && payload.cost.total_cost_usd) || 0),
    tokens,
    cwd_hash: cwdHash,
  };
}

// Some fraction of "tip" slots (never sponsor/bonus/heartbeat/jackpot --
// those have to show the real, billed content) get replaced with a line
// composed entirely here, from signals that never left this machine for
// this purpose. cost/tokens/cwd_hash are still sent to the server, same
// as always, because the server needs them to verify real usage for
// billing -- this is a separate thing: the actual WORDS shown for a tip
// don't require a round trip at all, so some of the time they don't get
// one. No model, no network call, just local composition -- genuinely
// nothing to intercept, because nothing goes out.
const LOCAL_TIP_CHANCE = 0.4;
// Not every single call -- someone actively coding fires this every ~20s,
// so even a low chance still surfaces the reminder several times an hour.
const PAYOUT_REMINDER_CHANCE = 0.15;
const LOCAL_GENERIC_TIPS = [
  "This one didn't come from our servers. It came from your machine.",
  "Nobody but you and this terminal ever saw this line get made.",
  "No round trip for this one -- just you, right now.",
];

// The status line only redraws when a real event fires -- there's no
// animation frame loop to drive smooth motion. But it doesn't need one:
// deriving the emoji's position from the real wall clock instead of a
// stored counter means every refresh lands wherever the "flight" should
// genuinely be at that moment, not wherever the last render left off.
// Two terminals opened seconds apart show the same bird in the same
// place, because it's really just one continuous clock-driven position,
// sampled whenever a redraw happens to occur.
const FLYING_EMOJIS = ["\u{1F426}", "\u{1F680}", "✈️", "\u{1F388}", "\u{1F98B}"];
const RUNWAY_WIDTH = 26;
function generateFlyingEmojiLine() {
  const emoji = FLYING_EMOJIS[Math.floor(Date.now() / 4000) % FLYING_EMOJIS.length];
  const period = 2 * (RUNWAY_WIDTH - 1);
  const t = Math.floor(Date.now() / 250) % period;
  const pos = t <= RUNWAY_WIDTH - 1 ? t : period - t;
  return "-".repeat(pos) + emoji + "-".repeat(RUNWAY_WIDTH - 1 - pos);
}

function generateLocalTip(session) {
  const hour = new Date().getHours();
  const candidates = [generateFlyingEmojiLine()];
  if (session.cost > 0.01) {
    candidates.push(`You've spent $${session.cost.toFixed(2)} on this session so far. That number never left your machine.`);
  }
  if (session.tokens > 50000) {
    candidates.push(`${Math.round(session.tokens / 1000)}k tokens deep this session. Still here.`);
  }
  if (hour >= 0 && hour < 5) {
    candidates.push(`It's past midnight where you are. The agent doesn't know that. You do.`);
  } else if (hour >= 5 && hour < 9) {
    candidates.push(`Early. Whatever you're building, you started before most people were up.`);
  }
  candidates.push(...LOCAL_GENERIC_TIPS);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function fetchLine(installId, session) {
  const params = new URLSearchParams({
    id: installId,
    event: session.event,
    sid: session.session_id,
    cost: String(session.cost),
    tok: String(session.tokens),
    cwd: session.cwd_hash,
  });
  const url = `${SERVER_URL}/line?${params}`;
  try {
    // 6s: a cold Node start plus DNS/TLS can eat close to a second before
    // the request even goes out. A short timeout here just means falling
    // back to filler more often than necessary, never a hung terminal.
    const res = await fetch(url, {
      headers: { "User-Agent": "deadtime-client/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return FALLBACK_LINE;
    const data = await res.json();
    // Real money sitting uncollected because someone skipped payout setup
    // and never came back -- surfaced occasionally, not every call, so
    // it's a nudge instead of drowning out every real line with a nag.
    if (data.needs_payout && Math.random() < PAYOUT_REMINDER_CHANCE) {
      return "meanwhile: you're earning but haven't added a payout email -- npx trymeanwhile claim";
    }
    if (data.kind === "tip" && Math.random() < LOCAL_TIP_CHANCE) {
      return generateLocalTip(session);
    }
    return data.line;
  } catch {
    // server unreachable -- fail quiet and cheap, never break the terminal
    return FALLBACK_LINE;
  }
}

async function fetchEarnings(installId) {
  const url = `${SERVER_URL}/earnings?id=${installId}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "deadtime-client/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function printClaimInfo() {
  const installId = getInstallId();
  const earnings = await fetchEarnings(installId);
  const claimUrl = `${SERVER_URL}/claim?id=${installId}`;

  console.log("meanwhile -- your account");
  console.log(`  ID:      ${installId}`);
  if (earnings) {
    console.log(`  earned:  $${Number(earnings.user_earnings).toFixed(2)}`);
    console.log(`  shown:   ${earnings.total_calls} lines (${earnings.sponsor_calls} sponsored)`);
  } else {
    console.log("  earned:  (couldn't reach server -- check your connection)");
  }
  console.log();
  console.log(`  register a payout email: ${claimUrl}`);
}

async function main() {
  if (process.argv[2] === "--claim") {
    await printClaimInfo();
    return;
  }
  // Everything above only ever fails quiet and returns a fallback value --
  // but getInstallId() touches the filesystem (permission denied, read-only
  // home dir, disk full are all real possibilities out in the world), and
  // that must never take the terminal down with it. The site's own promise
  // is "never blocks or breaks your terminal" -- this makes that true.
  try {
    const session = readSessionState();
    const installId = getInstallId();
    console.log(await fetchLine(installId, session));
  } catch {
    console.log(FALLBACK_LINE);
  }
}

main();
