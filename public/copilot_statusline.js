#!/usr/bin/env node
// GitHub Copilot CLI status line -- Node port of copilot_statusline.py,
// same Python-dependency removal as statusline.js. Shares the install ID
// file with the Claude Code adapter on purpose: earnings from every client
// you use accumulate against one identity, one payout.
//
// Copilot CLI's statusLine.command hook is experimental (GitHub's own
// label, as of mid-2026) -- the JSON shape it pipes to stdin could change
// under us without notice. Every field read from stdin is read
// defensively for that reason.

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
  fs.writeFileSync(INSTALL_ID_FILE, id, { mode: 0o600 });
  try { fs.chmodSync(INSTALL_ID_FILE, 0o600); } catch {}
  return id;
}

// Copilot CLI's stdin payload is experimental and thin -- no cost or token
// fields the way Claude Code's is, just a session_id most of the time.
// That's still real evidence worth forwarding: a session_id that keeps
// changing means a live CLI session is actually cycling through real
// turns, which a bare polling script wouldn't have at all.
function readSessionState() {
  let sessionId = "";
  try {
    const raw = fs.readFileSync(0, "utf8");
    const payload = JSON.parse(raw);
    sessionId = String(payload.session_id || "");
  } catch {}
  return {
    event: sessionId ? `copilot:${sessionId}` : "copilot:response",
    session_id: sessionId,
    cost: "",
    tokens: "",
    cwd_hash: "",
  };
}

// Same idea as statusline.js's local tip generation, adapted for what
// Copilot CLI actually gives us: no cost or token fields at all (see
// readSessionState above), so there's nothing real to personalize a
// dollar-amount or token-count line with -- faking one from data that
// doesn't exist would be worse than not personalizing at all. Time of
// day is still real and local, so that stays; the rest is honest
// generic variety, composed here, no network call, no model.
const LOCAL_TIP_CHANCE = 0.4;
const PAYOUT_REMINDER_CHANCE = 0.15;
const LOCAL_GENERIC_TIPS = [
  "This one didn't come from our servers. It came from your machine.",
  "Nobody but you and this terminal ever saw this line get made.",
  "No round trip for this one -- just you, right now.",
];

// Position derives from the real wall clock, not a stored counter --
// see statusline.js's generateFlyingEmojiLine for why: every refresh
// lands wherever the "flight" genuinely should be at that instant.
const FLYING_EMOJIS = ["\u{1F426}", "\u{1F680}", "✈️", "\u{1F388}", "\u{1F98B}"];
const RUNWAY_WIDTH = 26;
function generateFlyingEmojiLine() {
  const emoji = FLYING_EMOJIS[Math.floor(Date.now() / 4000) % FLYING_EMOJIS.length];
  const period = 2 * (RUNWAY_WIDTH - 1);
  const t = Math.floor(Date.now() / 250) % period;
  const pos = t <= RUNWAY_WIDTH - 1 ? t : period - t;
  return "-".repeat(pos) + emoji + "-".repeat(RUNWAY_WIDTH - 1 - pos);
}

function generateLocalTip() {
  const hour = new Date().getHours();
  const candidates = [generateFlyingEmojiLine()];
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
    const res = await fetch(url, {
      headers: { "User-Agent": "deadtime-client/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return FALLBACK_LINE;
    const data = await res.json();
    if (data.needs_payout && Math.random() < PAYOUT_REMINDER_CHANCE) {
      return "meanwhile: you're earning but haven't added a payout email -- npx trymeanwhile claim";
    }
    if (data.kind === "tip" && Math.random() < LOCAL_TIP_CHANCE) {
      return generateLocalTip();
    }
    return data.line;
  } catch {
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
  try {
    const session = readSessionState();
    const installId = getInstallId();
    console.log(await fetchLine(installId, session));
  } catch {
    console.log(FALLBACK_LINE);
  }
}

main();
