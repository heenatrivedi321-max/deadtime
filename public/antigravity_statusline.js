#!/usr/bin/env node
// Google Antigravity CLI status line -- same shape as copilot_statusline.js:
// no cost/token concept in Antigravity's stdin payload (session_id, cwd,
// conversation_id, agent_state, context_window, etc -- no dollar figure),
// so this follows the Copilot client's pattern rather than Claude Code's.
// Shares the install ID file with every other client on purpose: earnings
// from every client you use accumulate against one identity, one payout.
//
// Antigravity's statusLine hook is new (2.0, mid-2026) -- every field read
// from stdin is read defensively, same reasoning as the Copilot adapter:
// the JSON shape could change under us without notice.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const SERVER_URL = "https://trymeanwhile.online";
const INSTALL_ID_FILE = path.join(os.homedir(), ".deadtime", "install_id");
const FALLBACK_LINE = "meanwhile: agent working...";

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

// conversation_id is checked before session_id on purpose: session_id
// names the whole CLI session and plausibly stays constant turn to turn,
// while conversation_id is the more likely per-exchange signal -- and the
// billing check on the server only counts this as "progress" if it
// actually changes between calls. Getting this backwards would mean a
// real, paying multi-turn session never bills at all, silently. cwd gets
// hashed, never sent in the clear, same as every other client here.
function readSessionState() {
  let sessionId = "";
  let cwdHash = "";
  try {
    const raw = fs.readFileSync(0, "utf8");
    const payload = JSON.parse(raw);
    sessionId = String(payload.conversation_id || payload.session_id || "");
    if (payload.cwd) {
      cwdHash = crypto.createHash("sha256").update(String(payload.cwd)).digest("hex").slice(0, 16);
    }
  } catch {}
  return {
    event: sessionId ? `antigravity:${sessionId}` : "antigravity:response",
    session_id: sessionId,
    cost: "",
    tokens: "",
    cwd_hash: cwdHash,
  };
}

// Same idea as the other clients' local tip generation: no cost/token
// fields to personalize with here, so time of day plus honest generic
// variety, composed here, no network call, no model.
const LOCAL_TIP_CHANCE = 0.4;
const LOCAL_GENERIC_TIPS = [
  "This one didn't come from our servers. It came from your machine.",
  "Nobody but you and this terminal ever saw this line get made.",
  "No round trip for this one -- just you, right now.",
];

// Position derives from the real wall clock, not a stored counter -- see
// statusline.js's generateFlyingEmojiLine for why: every refresh lands
// wherever the "flight" genuinely should be at that instant.
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
    if (data.kind === "tip" && Math.random() < LOCAL_TIP_CHANCE) {
      return generateLocalTip();
    }
    return data.line;
  } catch {
    return FALLBACK_LINE;
  }
}

async function main() {
  try {
    const session = readSessionState();
    const installId = getInstallId();
    console.log(await fetchLine(installId, session));
  } catch {
    console.log(FALLBACK_LINE);
  }
}

main();
