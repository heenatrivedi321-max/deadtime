/**
 * deadtime server — Cloudflare Worker
 *
 * Public, always-on version of the local prototype. Every installed
 * client talks to this instead of a file on one machine. Per-install
 * state lives in KV (INSTALLS), advertiser leads in KV (LEADS) — both
 * persistent across requests, which a local JSON file could never be
 * once this needs to serve more than one person.
 *
 * Same billing rule as the local version: a line only becomes a
 * billable impression once it's been continuously shown for
 * BILLABLE_THRESHOLD seconds. Enforced here, server-side — the only
 * place that can actually be trusted as the source of truth.
 */

/** 100 original lines -- deliberately real rather than generic-poster,
 * meant to land the way a good line does at 2am when the build finally
 * passes. Fallback pool for the AI-voice feature below: if that call
 * ever fails, this is what a user sees instead, so it has to carry the
 * whole feeling on its own, not read like a placeholder. */
const TIPS = [
  "The pause is not empty. It's where the next idea is standing.",
  "The best ideas arrive exactly when you stop chasing them.",
  "Somewhere, a bug is quietly being born so you can later find it.",
  "A river doesn't rush -- it just never stops.",
  "Patience is just thinking you haven't rushed yet.",
  "Every great answer was, for a moment, only a question.",
  "The work happens in the space between two keystrokes.",
  "Meanwhile, something is always becoming something else.",
  "Nobody sees the version that didn't work. They only see the one that did.",
  "You've deleted more code than most people will ever write. That's the job.",
  "The first version is never the truth. It's just the first guess that compiles.",
  "Somewhere, code you wrote years ago is still quietly keeping a promise.",
  "Every system you've ever loved was once somebody's messy first draft.",
  "The bug isn't personal. It never was. It just found you first.",
  "You don't remember most of what you built. It still remembers how to run.",
  "Nobody claps when the tests pass. Clap anyway.",
  "The empty file is the only part of this that's actually scary.",
  "Every real skill you have started as a error message you didn't understand.",
  "Somewhere tonight, your code is running and nobody thinks about you at all. Good.",
  "You are allowed to be proud of something nobody else will ever read.",
  "The hardest bugs teach you the most about the person who wrote the code.",
  "Most of what you'll build will be replaced. Build it well anyway.",
  "You've forgiven more broken builds than most people forgive people.",
  "It compiled. That's not nothing. That's the whole thing, actually.",
  "Somewhere, a stranger's problem just got smaller because of something you shipped.",
  "The comment nobody reads is still a message to someone. Usually future you.",
  "You learned this entire craft by being wrong, quickly, over and over.",
  "Nobody becomes good at this without staring at something broken for a while.",
  "The code you're proudest of, you probably wrote while unsure you could.",
  "Every clean function used to be a mess that finally made sense.",
  "You are the only person who will ever know how ugly the first draft was.",
  "Somewhere, a machine is doing exactly what you told it, patiently, forever.",
  "It's not that the bug is hiding. It's that you haven't asked it the right question yet.",
  "You've built things that outlasted the reasons you built them.",
  "The satisfaction of a passing test is small and real and yours.",
  "Every senior engineer was once terrified of the thing you're doing right now.",
  "You don't need to understand everything. You need to understand the next line.",
  "Somewhere, your work is the reason someone else's day went a little smoother.",
  "The blinking cursor isn't judging you. It's just waiting, same as you.",
  "You've solved harder problems than this one. You just don't remember them as hard.",
  "Nobody warns you that shipping feels like letting go of something you were holding.",
  "The best code reads like someone was being kind to whoever came next.",
  "You are allowed to not know. That's most of the job, actually.",
  "Somewhere, a person you'll never meet is using something you built without thinking about it. That's the goal.",
  "The gap between what you meant and what you wrote is where you actually live.",
  "You've made peace with more uncertainty than most people ever have to.",
  "Every deploy is a small act of trust in your past self.",
  "The work is slow because the work is real. Both things are true.",
  "You are not behind. You are exactly as far as today let you get.",
  "Somewhere, an old version of you would be proud of what you just casually did.",
  "The quiet ones who ship steadily outlast the loud ones who don't.",
  "You've built something from literally nothing more times than you give yourself credit for.",
  "Every crash report is just the machine finally being honest with you.",
  "The version control history is the only diary that never lies to you.",
  "You don't need the whole plan. You need the next honest step.",
  "Somewhere, the fix is smaller than you think it is right now.",
  "The work you do when nobody's watching is still the work.",
  "You've earned the right to be tired. Rest counts as progress too.",
  "Every rabbit hole you fall into teaches you the shape of the warren.",
  "The code doesn't care how you feel about it. It runs anyway. That's a kind of mercy.",
  "You are building a thing that didn't exist this morning. Sit with that for a second.",
  "Somewhere, this exact frustration is the last step before the breakthrough.",
  "The best debugging tool is still just a person willing to keep looking.",
  "You've turned confusion into clarity more times than you'll ever count.",
  "Every good architecture started as someone refusing to accept a mess.",
  "The stack trace is trying to help you. It's just bad at saying so.",
  "You don't have to love every part of this to be good at it.",
  "Somewhere, someone is grateful for an error message you wrote months ago.",
  "The work that feels invisible is usually the work holding everything up.",
  "You've made something real out of something that was only ever an idea.",
  "Every refactor is a small act of respect for whoever reads this next.",
  "The silence while it loads is not wasted. You're still here, still working.",
  "You are more capable right now than you were an hour ago. That's just true.",
  "Somewhere, a test you wrote is quietly protecting a stranger's bad day.",
  "The thing you're stuck on is smaller than the thing you already solved today.",
  "You've written code that will outlive the reason you wrote it.",
  "Every \"it depends\" answer you've given was earned the hard way.",
  "The build failing is not an ending. It's just the machine asking again.",
  "You don't need permission to be proud of clean, boring, working code.",
  "Somewhere, your patience today becomes someone else's easy tomorrow.",
  "The best engineers you know still Google the basics sometimes. So do you.",
  "You are closer to done than the file explorer makes it look.",
  "Every dependency you understand is one less thing that can surprise you.",
  "The work is the practice. There isn't a version of this without the struggle.",
  "You've held more complexity in your head than most jobs ever ask of anyone.",
  "Somewhere, this exact wait is the last quiet second before it clicks.",
  "The line between stuck and almost-there is thinner than it feels right now.",
  "You don't have to finish today. You have to still be here tomorrow.",
  "Every system you maintain is a small promise you keep making, again and again.",
  "The code that finally works doesn't care how many tries it took.",
  "You are allowed to step away and come back smarter. That's not failure.",
  "Somewhere, the thing you built quietly saved someone real time today.",
  "The best fix is usually simpler than the one you're currently trying.",
  "You've earned every bit of instinct you now call obvious.",
  "Every so often, the work goes quiet, and that's when it's actually working.",
  "You are not just writing code. You're deciding what gets to exist.",
  "Somewhere, the exact fix you need is one honest look away.",
  "You've turned \"I have no idea\" into \"I figured it out\" more times than you remember.",
  "The work doesn't need to be loud to matter. Most of the good stuff is quiet.",
  "You are still here. After everything today asked of you, you are still here.",
];

/** Shown only to installs currently inside their active promo window,
 * only when there's genuinely no real sponsor to display, capped by
 * PROMO_BONUS_DAILY_CAP -- see the constant's own comment for why this
 * replaced a fake "(sponsored)" house line that used to bill the same
 * money with none of the honesty. */
const PROMO_BONUS_LINES = [
  "meanwhile: no real sponsors yet -- this one's on us.",
  "meanwhile: zero advertisers online right now -- have one on the house.",
  "meanwhile: nothing to sponsor this with yet, so we're covering it ourselves.",
];

/** "Give the AI a real voice" -- instead of always picking from the
 * static TIPS list above, some fraction of non-sponsor lines are
 * generated fresh by a small, fast model on Cloudflare Workers AI
 * (no new API key/secret -- it's a native binding on this same
 * platform), reacting to time-of-day and how active the session's
 * been today. Deliberately the one feature idea this session that
 * doesn't need scale to be worth anything -- it has to be good the
 * very first time a single person sees it, with zero other users,
 * zero advertisers, zero network effect. */
const WITTY_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const WITTY_CHANCE = 0.35;
const WITTY_TIMEOUT_MS = 2500;

function timeOfDayLabel() {
  const hour = new Date().getUTCHours();
  if (hour < 5) return "very late at night, past midnight";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "late at night";
}

function activityLabel(state) {
  const n = state.billed_today || 0;
  if (n === 0) return "this is their first real pause of the session so far";
  if (n < 5) return "they've had a few pauses like this already today";
  if (n < 20) return "they've been at this a good while today";
  return "they've been grinding for a long stretch today";
}

/** Never let this be the thing that breaks /line. A timeout, a model
 * error, a weird/oversized response -- anything at all -- falls back
 * to null, and the caller falls back to the static TIPS array exactly
 * like this feature never existed. */
async function generateWittyLine(env, state) {
  if (!env.AI) return null;
  const prompt = `Write exactly ONE short, witty, slightly irreverent one-line message (under 90 characters, no quotes, no emoji, no markdown) for a developer's terminal status bar. It shows while they wait for their AI coding assistant to respond. Context: it's currently ${timeOfDayLabel()} (UTC), and ${activityLabel(state)}. Make it feel like a clever friend glancing over their shoulder -- funny, a little unhinged, never mean, never corporate, never a generic "productivity tip". Do not mention code, files, or anything technical about their work. Reply with ONLY the line itself, nothing else.`;

  try {
    const aiPromise = env.AI.run(WITTY_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 60,
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("witty line timeout")), WITTY_TIMEOUT_MS));
    const result = await Promise.race([aiPromise, timeoutPromise]);
    let text = (result && result.response ? result.response : "").trim();
    text = text.replace(/^["'“”]+|["'“”]+$/g, "").trim();
    if (!text || text.length > 140) return null;
    return text;
  } catch (e) {
    return null;
  }
}

const IMPRESSIONS_PER_BLOCK = 1000;
const USD_PER_BLOCK = 15.0;
const PAYPAL_API = "https://api-m.paypal.com"; // LIVE -- real money, no sandbox fallback configured

const FILL_CEILING = 0.8;
const BILLABLE_THRESHOLD = 10;

/** Before real advertisers exist, pickLine used to fall back to a house
 * line labeled "(sponsored)" -- and handleLine's billing block counted
 * it exactly like a real paid impression, no different check at all.
 * That's a real, live financial hole: it billed (and would eventually
 * PayPal-payout) real money backed by zero actual ad revenue, completely
 * unbounded -- scales with however many people install, automatically,
 * with no cap and no visibility into how much is owed. Worse, it's the
 * exact kind of "claims one thing, code does another" gap this product
 * exists specifically to NOT have.
 *
 * This replaces that with a decision, not an accident: a small, capped,
 * honestly-labeled bonus, scoped only to installs currently inside their
 * active promo window (see isInPromoWindow below) -- a known, time-
 * bounded population, never a permanent one -- with its own low daily
 * ceiling completely separate from the real DAILY_BILLABLE_CAP. It's
 * tracked separately (bonus_calls, not sponsor_calls) so it never
 * inflates the honest "X% sponsored" stat shown back to the user or on
 * the public badge. */
const PROMO_BONUS_DAILY_CAP = 20;
const CPM = 15.0;
const USER_SHARE = 0.5;

/** Early-adopter deal, replacing the old permanent "first 100 keep 60%
 * forever" founder scheme entirely -- deliberately chosen instead of
 * layering a second forever-perk on top of it, since a permanent
 * zero/reduced-margin commitment on 1,000 people (10x the old founder
 * pool) compounds into real, unbounded-over-time cost in a way a
 * *time-boxed* perk on the same population doesn't. The first
 * PROMO_SPOTS installs ever to touch the server get PROMO_RATE (100%)
 * of every real sponsor dollar for PROMO_WINDOW_DAYS days from their own
 * first contact -- not a shared clock, each install's window starts
 * when THEY start. After their window closes, they fall to the exact
 * same USER_SHARE everyone else gets. No permanent tier, for anyone --
 * the whole promo is bounded by count (1,000) and by time (90 days per
 * person), so total lifetime exposure is knowable in advance instead of
 * growing forever the way the old permanent scheme did. */
const PROMO_SPOTS = 1000;
const PROMO_RATE = 1.0;
const PROMO_WINDOW_DAYS = 90;
const PROMO_WINDOW_SECONDS = PROMO_WINDOW_DAYS * 24 * 60 * 60;

function isInPromoWindow(state) {
  if (!state || !state.promo_number || !state.promo_started_at) return false;
  return Date.now() / 1000 - state.promo_started_at < PROMO_WINDOW_SECONDS;
}

function userShareFor(state) {
  return isInPromoWindow(state) ? PROMO_RATE : USER_SHARE;
}

/** ---- The Meanwhile Jackpot ----
 * Once a month, one currently-active developer with a registered payout
 * email gets a real, unannounced payout, delivered the same way a tip or
 * sponsor line is -- it just shows up in their status line. Funded ONLY
 * from the house's own already-collected share of real revenue (half of
 * every captured campaign payment, tracked in ledger:house_revenue_total
 * below) -- never a promise against money that hasn't actually come in
 * yet. If the pool is too small, the draw is skipped for that month,
 * full stop, logged plainly. This is the whole point of tracking the
 * ledger at all: a jackpot that could ever pay out more than the house
 * has actually earned is a liability wearing a party hat. */
const JACKPOT_MIN_POOL_USD = 50; // don't even attempt a draw below this
const JACKPOT_PAYOUT_FRACTION = 0.5; // pay out at most half the pool -- never drain it in one draw
const JACKPOT_MAX_PAYOUT_USD = 500; // hard ceiling regardless of pool size
const JACKPOT_MIN_CALLS = 10; // a fresh test install can't win -- needs real usage

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

/** Durable error log -- unlike `wrangler tail` (expires after ~30 min and
 * requires someone watching live), this persists in KV so any failure in
 * a money-moving path can be reviewed hours or days later via
 * /admin/errors. Capped to the most recent 200 entries. */
async function logError(env, category, message, details) {
  try {
    const entry = {
      id: crypto.randomUUID(),
      category,
      message,
      details: details ? String(details).slice(0, 2000) : null,
      at: Date.now() / 1000,
    };
    await env.ERRORS.put(`error:${entry.id}`, JSON.stringify(entry));
    const indexRaw = await env.ERRORS.get("index");
    const index = indexRaw ? JSON.parse(indexRaw) : [];
    index.unshift(entry.id);
    if (index.length > 200) index.length = 200;
    await env.ERRORS.put("index", JSON.stringify(index));
  } catch (e) {
    // logging must never itself break the real request path
  }
}

function defaultState() {
  return {
    total_calls: 0,
    sponsor_calls: 0,
    bonus_calls: 0,
    bonus_today: 0,
    current_kind: null,
    current_line: null,
    line_started: 0,
    billed_current: false,
    payout_email: null,
    current_campaign_id: null,
    paid_out_usd: 0,
    last_payout_at: null,
    billing_day: null,
    billed_today: 0,
    promo_number: null,
    promo_started_at: null,
    daily_earnings: {},
  };
}

/** Assigns a promo number exactly once, at true first contact with the
 * server -- whichever endpoint an install hits first (usually /line or
 * the name-claim call right after install opens the browser). Existing
 * installs are returned untouched; only a genuinely new one competes for
 * a spot. KV has no atomic increment, so this is read-modify-write, not
 * a real compare-and-swap -- at PROMO_SPOTS = 1000 and the traffic this
 * system sees, a lost race is a real but small risk (worst case, a
 * spot's number gets reused or the count runs slightly over 1000), not
 * worth a Durable Object for. Once a number is written it is never
 * reassigned or revoked -- but unlike the old founder scheme, the RATE
 * it unlocks still expires after PROMO_WINDOW_DAYS regardless. */
async function getOrCreateState(env, installId) {
  const key = `install:${installId}`;
  const raw = await env.INSTALLS.get(key);
  if (raw) return JSON.parse(raw);

  const state = defaultState();
  // meta:promo_count is one shared key across every brand-new install --
  // fine at low signup volume, but a real burst of concurrent new
  // installs (a launch spike is exactly this) all try to read-then-write
  // that same key at once, and Cloudflare KV enforces roughly one write
  // per second per key. Found live via a 30-concurrent-request stress
  // test against /line: some of those writes come back "429 Too Many
  // Requests" from KV itself. Missing out on a promo slot during a
  // burst is a real but survivable loss (the perk doesn't fire, this
  // one time); crashing the whole /line call so the new install never
  // even gets its first line is a much worse failure for exactly the
  // moment (a launch spike) this matters most. Fail toward the survivable
  // outcome.
  try {
    const countRaw = await env.INSTALLS.get("meta:promo_count");
    const count = countRaw ? parseInt(countRaw, 10) : 0;
    if (count < PROMO_SPOTS) {
      state.promo_number = count + 1;
      state.promo_started_at = Date.now() / 1000;
      await env.INSTALLS.put("meta:promo_count", String(count + 1));
    }
  } catch (e) {
    await logError(env, "promo_count_write_failed", `install ${installId} may have missed a promo slot due to KV contention`, e.message);
  }
  // Same reasoning as handleLine's final write -- a brand-new install
  // still needs its first line even if this particular persist fails.
  // The in-memory `state` returned below is enough for THIS call; if the
  // write keeps failing, the next call just repeats getOrCreateState's
  // "no raw record yet" path and tries again, rather than the install
  // being stuck erroring forever.
  try {
    await env.INSTALLS.put(key, JSON.stringify(state));
  } catch (e) {
    await logError(env, "install_state_write_failed", `new install ${installId} couldn't be persisted this call`, e.message);
  }
  return state;
}

/** No signup exists anywhere in this system -- an install_id is just a
 * self-generated UUID, and /line has no way to verify a call actually
 * came from a real Claude Code session versus a script hitting the
 * endpoint every ~10 seconds forever. This cap was originally 2000,
 * set when FILL_CEILING was 0.4 -- worth re-deriving now that
 * FILL_CEILING is 0.8 (raised across two later changes this session),
 * since this cap and that ceiling directly determine how fast a single
 * bad-faith install can drain a real advertiser's paid campaign: at the
 * old 2000/day cap, one malicious install hitting the daily limit could
 * generate up to 2000*0.8 = 1600 fake sponsor impressions in a single
 * day -- enough to fully drain any campaign at or under 1600
 * impressions (a $2 minimum campaign is 1000) before the advertiser's
 * own dashboard would show anything looking obviously wrong. Tightened
 * to 500/day: still generous for a genuine heavy user (real coding
 * involves reading and thinking between prompts, not a new billable
 * event every single 10-second window for 20+ hours straight), while
 * cutting one malicious install's max daily drain to 500*0.8 = 400
 * impressions -- a 4x reduction, no longer enough on its own to fully
 * drain even the smallest real campaign in a day. Doesn't stop a
 * patient bot staying under the cap entirely; it puts a hard ceiling on
 * the fast, crude version of the attack, at a level no real user will
 * ever hit. */
const DAILY_BILLABLE_CAP = 500;
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** House revenue ledger -- half of every REAL captured campaign payment
 * (never a pending/created order, only an actual PayPal capture) lands
 * here. Same retry-and-verify pattern as the campaign index write
 * above, since this is another single shared KV key with no compare-
 * and-swap: read, modify, write, then re-read to confirm it landed,
 * retrying a few times if not. Getting this number wrong in either
 * direction is a real problem -- too high risks a jackpot payout the
 * house hasn't actually earned; too low just means an overly cautious
 * jackpot, the safe direction to fail in. */
async function adjustHouseLedger(env, field, deltaUsd) {
  const key = `ledger:${field}`;
  let done = false;
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150 * attempt));
    const raw = await env.CAMPAIGNS.get(key);
    const current = raw ? parseFloat(raw) : 0;
    const next = Math.round((current + deltaUsd) * 100) / 100;
    await env.CAMPAIGNS.put(key, String(next));
    const verify = await env.CAMPAIGNS.get(key);
    done = verify !== null && parseFloat(verify) === next;
  }
  if (!done) {
    await logError(env, "house_ledger_write_unconfirmed", `adjusting ${field} by ${deltaUsd}`, `write never verified after retries -- check ledger:${field} manually`);
  }
}

async function getHouseLedger(env) {
  const [revenueRaw, jackpotPaidRaw] = await Promise.all([
    env.CAMPAIGNS.get("ledger:house_revenue_total"),
    env.CAMPAIGNS.get("ledger:jackpot_paid_total"),
  ]);
  const revenueTotal = revenueRaw ? parseFloat(revenueRaw) : 0;
  const jackpotPaidTotal = jackpotPaidRaw ? parseFloat(jackpotPaidRaw) : 0;
  // The house's own share is half of real revenue -- the other half was
  // always the developers'. What's actually available to give away via
  // the jackpot is that share, minus whatever's already been given away.
  const availablePool = Math.round((revenueTotal * (1 - USER_SHARE) - jackpotPaidTotal) * 100) / 100;
  return { revenueTotal, jackpotPaidTotal, availablePool };
}

/** Shared retry-and-verify read-modify-write for the campaign "index" --
 * a single shared KV key with no compare-and-swap, touched both when a
 * campaign is created (add) and when one is deleted (remove). Extracted
 * here after finding handleDeleteCampaign never removed the deleted
 * ID -- confirmed live: 7 of 8 "real" campaigns in the index were
 * actually ghosts left behind by past deletions. transform receives the
 * current array and returns the next one; checkLanded confirms the
 * specific change actually took effect after the write. */
async function updateCampaignIndex(env, transform, checkLanded) {
  let landed = false;
  for (let attempt = 0; attempt < 4 && !landed; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150 * attempt));
    const indexRaw = await env.CAMPAIGNS.get("index");
    const index = transform(indexRaw ? JSON.parse(indexRaw) : []);
    await env.CAMPAIGNS.put("index", JSON.stringify(index));
    const verifyRaw = await env.CAMPAIGNS.get("index");
    landed = checkLanded(verifyRaw ? JSON.parse(verifyRaw) : []);
  }
  return landed;
}

function sponsorRatio(state) {
  if (state.total_calls === 0) return 0;
  return state.sponsor_calls / state.total_calls;
}

// Standard ANSI codes only (bold + code 33, not 24-bit truecolor) --
// Claude Code's statusLine docs confirm real ANSI support, but truecolor
// specifically has a documented washed-out-color bug in some terminal
// versions (anthropics/claude-code#35806). Bold + a standard color code
// is the actually reliable way to make the disclosure tag stand out
// without risking garbled or washed-out output on someone's real
// terminal -- the whole point is legible disclosure, not decoration.
const ANSI_BOLD = "\x1b[1m";
const ANSI_GOLD = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";

function formatCampaignLine(campaign) {
  return `${ANSI_BOLD}${ANSI_GOLD}(sponsored)${ANSI_RESET} ${campaign.line} -> ${campaign.url}`;
}

/** Active campaigns are the real, paid-and-activated ad pool. When it's
 * empty, pickLine falls through to the promo bonus (capped, honestly
 * labeled) or a plain tip -- never a fake ad standing in for a real one. */
async function getActiveCampaigns(env) {
  const raw = await env.CAMPAIGNS.get("index");
  const ids = raw ? JSON.parse(raw) : [];
  const campaigns = [];
  for (const id of ids) {
    const c = await env.CAMPAIGNS.get(`campaign:${id}`);
    if (!c) continue;
    const campaign = JSON.parse(c);
    if (campaign.status === "active" && campaign.impressions_delivered < campaign.impressions_total) {
      campaigns.push(campaign);
    }
  }
  return campaigns;
}

/** Replaces the old flat FILL_CEILING-as-eligibility-rate with real
 * pacing math: how much real, remaining, PAID campaign budget is
 * actually left, right now, versus a reference level considered
 * "healthy" supply. Rich inventory lets the ceiling approach
 * FILL_CEILING (still the hard upper bound -- "never 5/5" stays true no
 * matter how much budget is queued up). Thin inventory scales the
 * ceiling down toward MIN_CEILING instead of burning through whatever's
 * left at full rate and then hitting a wall -- the same pacing idea
 * real ad platforms use to spread a budget across a campaign's full
 * window instead of exhausting it in the first hour. No active budget
 * at all returns 0 -- handled honestly by the promo-bonus/tip
 * fallback in pickLine, never a fake ad standing in for a real one. */
const PACING_REFERENCE_IMPRESSIONS = 200;
const MIN_CEILING = 0.15;
function computeEffectiveCeiling(activeCampaigns) {
  const totalRemaining = activeCampaigns.reduce(
    (sum, c) => sum + Math.max(0, c.impressions_total - c.impressions_delivered),
    0
  );
  if (totalRemaining <= 0) return 0;
  const pressure = Math.min(1, totalRemaining / PACING_REFERENCE_IMPRESSIONS);
  return MIN_CEILING + (FILL_CEILING - MIN_CEILING) * pressure;
}

async function pickLine(env, state) {
  // A jackpot win takes priority over everything else and is shown
  // exactly once -- consumed and cleared right here, the same object
  // the caller persists right after.
  if (state.pending_jackpot_win) {
    const amount = state.pending_jackpot_win.amount;
    delete state.pending_jackpot_win;
    return { kind: "jackpot", line: `deadtime: you just won $${amount.toFixed(2)} from the Meanwhile Jackpot -- check your email, it's already sent -> trymeanwhile.online/jackpot` };
  }

  // The Heartbeat: tagged for everyone real-active in the last 24h at
  // the same instant (see fireHeartbeat) -- shown exactly once, the
  // next time each of them is shown a line at all.
  if (state.pending_heartbeat) {
    const others = Math.max(0, (state.pending_heartbeat.network_size || 1) - 1);
    delete state.pending_heartbeat;
    const line = others > 0
      ? `deadtime: this message just reached ${others} other developer${others === 1 ? "" : "s"}, at this exact instant -> you're not the only one waiting.`
      : `deadtime: today, this message only reached you -> still counts. meanwhile.`;
    return { kind: "heartbeat", line };
  }

  // Real supply/demand math, not a call to a model -- this runs on every
  // single /line request, the hottest path in the app, and it's a
  // numeric decision (how much real inventory is actually left), not a
  // creative one. Fetched here, not after the eligibility check, so the
  // real remaining budget across active campaigns can inform that check
  // instead of the other way around -- no extra KV read versus before,
  // getActiveCampaigns() was already called further down regardless.
  const active = await getActiveCampaigns(env);
  const effectiveCeiling = computeEffectiveCeiling(active);
  const ratio = sponsorRatio(state);

  // Real sponsor slot, paced by real remaining campaign budget.
  if (active.length > 0 && effectiveCeiling > 0 && ratio < effectiveCeiling && Math.random() < effectiveCeiling) {
    const campaign = active[Math.floor(Math.random() * active.length)];
    return { kind: "sponsor", line: formatCampaignLine(campaign), campaign_id: campaign.id };
  }

  // No real sponsor this time -- either there's genuinely no active
  // campaign, or there is but the pacing roll didn't land one. Installs
  // currently inside their active promo window (a known, time-bounded
  // population) still get a shot at an honestly-labeled bonus instead of
  // a fake ad, gated by the FLAT FILL_CEILING rate a real sponsor slot
  // would've used in a demand-rich world -- deliberately NOT the real-
  // inventory-aware effectiveCeiling above. Tying the bonus to that
  // instead would make it structurally unreachable exactly when it's
  // needed most: confirmed live, with zero active campaigns
  // effectiveCeiling is always 0, and the original single shared
  // eligibility check meant this whole branch could never fire at all
  // while real advertiser demand was zero -- precisely the condition
  // the bonus exists to cover. Everyone outside their promo window just
  // gets a real tip; showing NOTHING paid is the honest answer when
  // there's genuinely nothing to sponsor it with, not a disguised ad.
  if (isInPromoWindow(state) && (state.bonus_today || 0) < PROMO_BONUS_DAILY_CAP && Math.random() < FILL_CEILING) {
    const line = PROMO_BONUS_LINES[Math.floor(Math.random() * PROMO_BONUS_LINES.length)];
    return { kind: "bonus", line };
  }
  if (Math.random() < WITTY_CHANCE) {
    const witty = await generateWittyLine(env, state);
    if (witty) return { kind: "tip", line: witty };
  }
  return { kind: "tip", line: TIPS[Math.floor(Math.random() * TIPS.length)] };
}

/** Public, stateless, no install_id, no KV write, no billing -- exists
 * purely so the homepage can prove "this isn't static" by showing real
 * rotating content live in front of a visitor who hasn't installed
 * anything yet. Deliberately never returns a sponsor line (a real
 * paying campaign showing up unpredictably in a marketing demo would
 * be a strange thing to stumble into); it's scoped to exactly the part
 * of the product being shown off here -- the tip/AI-voice rotation --
 * not the whole billing engine. Same WITTY_CHANCE odds as the real
 * thing, so what a visitor sees here is honestly representative of
 * what an installed client actually shows, not a rigged demo. */
async function handleDemoLine(env) {
  const fakeState = { billed_today: Math.floor(Math.random() * 12) };
  let line;
  if (Math.random() < WITTY_CHANCE) {
    line = await generateWittyLine(env, fakeState);
  }
  if (!line) {
    line = TIPS[Math.floor(Math.random() * TIPS.length)];
  }
  const res = json({ line });
  res.headers.set("cache-control", "no-store");
  return res;
}

/** Called when a sponsor line is actually billed -- attributes the real
 * impression to its campaign and exhausts it once the paid block runs out.
 *
 * Used to be a read-increment-write straight against the shared KV key,
 * with a retry-and-verify best-effort mitigation. Stress-tested that
 * directly: 20 concurrent deliveries to one campaign landed only 2 of the
 * 20 increments -- 90% lost under real concurrency, confirming the code's
 * own comment ("narrows the window, doesn't close it") was true, and
 * worse than it sounded. KV has no compare-and-swap, so no amount of
 * retrying fixes this on KV alone.
 *
 * Now routes through a CampaignCounter Durable Object instead, one DO
 * instance per campaign (via idFromName). Durable Objects serialize
 * requests to the same instance automatically -- at most one `fetch` is
 * ever being handled at a time for a given campaign, so the increment
 * genuinely can't race with itself, no retry-and-hope needed. The DO
 * mirrors the result back into the KV campaign record so every existing
 * read path (getActiveCampaigns, handleCampaignStatus, the admin list)
 * keeps working unchanged. */
async function deliverImpression(env, campaignId) {
  if (!campaignId) return;
  try {
    const id = env.CAMPAIGN_COUNTER.idFromName(campaignId);
    const stub = env.CAMPAIGN_COUNTER.get(id);
    const res = await stub.fetch("https://campaign-counter/deliver", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await logError(env, "campaign_counter_do_failed", `delivering impression for campaign ${campaignId}`, `status ${res.status}: ${detail}`);
    }
  } catch (e) {
    await logError(env, "campaign_counter_do_failed", `delivering impression for campaign ${campaignId}`, e.message);
  }
}

/** One instance per campaign (Durable Objects key by idFromName(campaignId)
 * in deliverImpression above), so every delivery for the SAME campaign --
 * the actual point of contention -- funnels through the same single-
 * threaded instance and is processed strictly one at a time. Different
 * campaigns get different instances and don't contend with each other at
 * all, which is exactly the right granularity: the race was always
 * per-campaign, never global. */
export class CampaignCounter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let data;
    try {
      data = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
    }
    const { campaignId } = data;
    if (!campaignId) return new Response(JSON.stringify({ error: "missing campaignId" }), { status: 400 });

    const key = `campaign:${campaignId}`;
    const raw = await this.env.CAMPAIGNS.get(key);
    if (!raw) return new Response(JSON.stringify({ error: "campaign not found" }), { status: 404 });
    const campaign = JSON.parse(raw);

    // This instance's own durable storage is the running count once it
    // exists -- seeded from KV the first time this campaign is ever
    // delivered to, authoritative from then on, so a stale KV read never
    // overwrites a count this DO already advanced past.
    let delivered = await this.state.storage.get("impressions_delivered");
    if (delivered === undefined) delivered = campaign.impressions_delivered || 0;
    delivered += 1;
    await this.state.storage.put("impressions_delivered", delivered);

    // Same durable-first pattern for the per-day breakdown, so the
    // advertiser dashboard has something to chart -- a running total
    // alone can't show "is this picking up or slowing down."
    let daily = await this.state.storage.get("daily_impressions");
    if (daily === undefined) daily = campaign.daily_impressions || {};
    const today = todayUTC();
    daily[today] = (daily[today] || 0) + 1;
    await this.state.storage.put("daily_impressions", daily);

    campaign.impressions_delivered = delivered;
    campaign.daily_impressions = daily;
    if (delivered >= campaign.impressions_total) {
      campaign.status = "exhausted";
    }
    await this.env.CAMPAIGNS.put(key, JSON.stringify(campaign));

    return new Response(JSON.stringify({ ok: true, impressions_delivered: delivered, status: campaign.status }));
  }
}

/** Does this call carry ANY real session telemetry at all? A script just
 * pinging /line on a timer, with no genuine Claude Code/Copilot process
 * behind it, has nothing to put in these fields -- they only exist
 * because a real client read them off real session state. */
function hasSessionEvidence(ev) {
  return !!(ev.sessionId || ev.cwdHash || ev.cost !== null || ev.tokens !== null);
}

/** Did the session actually move between when this line started and now?
 * No baseline to compare against (fresh state) can't be penalized -- but
 * in practice that path is already unreachable, since a fresh install's
 * current_line starts null and nothing bills on the very first call.
 *
 * cost/tokens must strictly INCREASE, not merely differ -- a real turn
 * always costs something more than the last one, but "differ" is also
 * satisfied by a static-then-decremented fake, or by a script that just
 * flips a value back and forth. Checking `>` instead of `!==` closes
 * that off for free.
 *
 * cwdHash/sessionId no longer count on their own. They used to be
 * independent OR branches -- which meant a scripted loop could skip
 * faking cost/tokens entirely and just randomize a fake sessionId (or
 * cwd) every call, since either one alone was accepted as "progress".
 * That's the actual gap a static analysis of this function doesn't
 * show but a scripted client trivially exploits: sessionId/cwdHash are
 * arbitrary client strings with no cost to change, unlike cost/tokens
 * which at least have to look like real accumulating usage. They're
 * kept only as a fallback for clients that never send cost/tokens at
 * all (hasSessionEvidence still admits sessionId/cwdHash-only evidence
 * as "some" evidence, so this keeps that path honest rather than
 * silently billing it as free real usage).
 *
 * Real trade-off, accepted on purpose: total_input_tokens/cost are
 * per-session counters, so the very first event right after a genuinely
 * new Claude Code session starts (new terminal, etc.) can show a lower
 * number than the just-ended session's baseline -- that one event goes
 * unbilled. Every event after it bills normally once the new session's
 * own counters climb past its own baseline. There's no way to tell that
 * real reset apart from an attacker claiming one (both look identical
 * from the server's side), so this fails in the safe direction -- same
 * philosophy as the jackpot ledger elsewhere in this file: missing one
 * legitimate billable event beats leaving the trivial-to-fake shortcut
 * open. */
function sessionProgressed(baseline, current) {
  if (!baseline) return true;
  if (current.cost !== null && baseline.cost !== null && current.cost > baseline.cost) return true;
  if (current.tokens !== null && baseline.tokens !== null && current.tokens > baseline.tokens) return true;
  const noCostEvidence = current.cost === null && baseline.cost === null;
  const noTokenEvidence = current.tokens === null && baseline.tokens === null;
  if (noCostEvidence && noTokenEvidence) {
    if (current.cwdHash && baseline.cwdHash && current.cwdHash !== baseline.cwdHash) return true;
    if (current.sessionId && baseline.sessionId && current.sessionId !== baseline.sessionId) return true;
  }
  return false;
}

async function handleLine(env, installId, eventName, sessionEvidence) {
  const key = `install:${installId}`;
  const state = await getOrCreateState(env, installId);
  const now = Date.now() / 1000;

  // Claude Code only calls us on real events (new message, session start,
  // /compact, etc.) -- never a blind timer, since we don't set a
  // refreshInterval. So every invocation IS a real activity signal. Bill
  // the OUTGOING line here, based on how long it was genuinely on screen
  // since the last real event -- not an artificial server-side clock.
  const today = todayUTC();
  if (state.billing_day !== today) {
    state.billing_day = today;
    state.billed_today = 0;
    state.bonus_today = 0;
  }

  if (state.current_line !== null && !state.billed_current) {
    const visibleFor = now - state.line_started;
    // Time alone was the whole check before -- but an install ID is just a
    // UUID sitting in a local file, readable (and fakeable) by whoever
    // owns that install. A script that knows its own ID can ping /line on
    // a timer with zero real Claude Code session behind it, and time-only
    // billing couldn't tell the difference -- worse, sponsor calls bill
    // real advertiser budget for impressions nobody ever saw. Requiring
    // genuine session evidence, and requiring it to have actually moved
    // since this line started, closes that off without needing to trust
    // anything the client merely claims.
    // The `wrap` command (npx trymeanwhile wrap -- <any shell command>) has
    // no Claude Code/Copilot session to read telemetry from -- it's a
    // different, trusted client polling on its own fixed 15s loop while a
    // real child process it spawned is genuinely still running. Not the
    // vector this fix targets, so it keeps the time-only check it always
    // had rather than being broken by a requirement it has no way to meet.
    const isWrapCommand = eventName === "cli_wrap";
    const hasEvidence = isWrapCommand || hasSessionEvidence(sessionEvidence);
    const progressed = isWrapCommand || (hasEvidence && sessionProgressed(state.line_started_session || null, sessionEvidence));
    if (visibleFor >= BILLABLE_THRESHOLD && progressed) {
      if (state.billed_today < DAILY_BILLABLE_CAP) {
        state.billed_current = true;
        state.total_calls += 1;
        state.billed_today += 1;
        if (state.current_kind === "sponsor") {
          state.sponsor_calls += 1;
          // Same reasoning as campaigns' daily_impressions: a running
          // total alone can't show "is this picking up or slowing down,"
          // so the user's own dashboard needs a day-by-day breakdown too.
          if (!state.daily_earnings) state.daily_earnings = {};
          const earnedThisCall = userShareFor(state) * (CPM / 1000);
          state.daily_earnings[today] = Math.round(((state.daily_earnings[today] || 0) + earnedThisCall) * 10000) / 10000;
          await deliverImpression(env, state.current_campaign_id);
        } else if (state.current_kind === "bonus" && (state.bonus_today || 0) < PROMO_BONUS_DAILY_CAP) {
          // Real money, same as a sponsor call, but tracked completely
          // separately (bonus_calls, not sponsor_calls) so it never
          // inflates the honest "X% sponsored" stat this same state
          // feeds into elsewhere -- this was never a sponsor, it's an
          // admitted, capped, on-purpose subsidy. No deliverImpression
          // call: there's no real campaign budget to decrement.
          state.bonus_calls = (state.bonus_calls || 0) + 1;
          state.bonus_today = (state.bonus_today || 0) + 1;
          if (!state.daily_earnings) state.daily_earnings = {};
          const earnedThisCall = userShareFor(state) * (CPM / 1000);
          state.daily_earnings[today] = Math.round(((state.daily_earnings[today] || 0) + earnedThisCall) * 10000) / 10000;
        }
      } else if (state.billed_today === DAILY_BILLABLE_CAP) {
        // Log once, not on every call past the cap -- a real signal
        // worth a human looking at, not log spam.
        state.billed_today += 1;
        await logError(env, "daily_billable_cap_hit", `install ${installId} hit the ${DAILY_BILLABLE_CAP}/day billable cap`, "either a genuinely extreme real user, or automated polling -- worth a look");
      }
    } else if (visibleFor >= BILLABLE_THRESHOLD && !progressed) {
      // Time threshold cleared but nothing about the session moved --
      // looks like a faked/static ping, not real usage. Don't bill, and
      // don't log per-call (a slow real session between rare events could
      // still legitimately trip this occasionally); only a sustained
      // pattern is worth a human looking at, which the daily-cap log
      // already exists to catch for the volume side of that.
    }
  }

  // Every real invocation picks a fresh line -- no artificial hold timer.
  const picked = await pickLine(env, state);
  state.current_kind = picked.kind;
  state.current_line = picked.line;
  state.current_campaign_id = picked.campaign_id || null;
  state.line_started = now;
  state.line_started_session = hasSessionEvidence(sessionEvidence) ? sessionEvidence : null;
  state.billed_current = false;
  state.last_event = eventName || "unknown";

  // The one thing that actually matters to a real user is getting a line
  // back -- state persistence (billing, daily_earnings, session baseline
  // for next call's progressed-check) is real but secondary. A downstream
  // KV outage (quota exhaustion, a transient Cloudflare incident) should
  // degrade to "this call's billing/tracking silently doesn't stick" --
  // survivable, self-heals the moment KV writes work again -- not "every
  // real developer's status line goes blank and the whole product looks
  // down." Found live: a KV daily-write-quota exhaustion turned this one
  // unguarded put() into a 500 for every single /line call account-wide.
  try {
    await env.INSTALLS.put(key, JSON.stringify(state));
  } catch (e) {
    await logError(env, "install_state_write_failed", `install ${installId}'s state didn't persist this call`, e.message);
  }
  // Real money can sit uncollected forever if someone skips the payout
  // step during onboarding and never comes back to it -- the terminal is
  // the only channel that reaches them regularly, so it's the only place
  // this reminder can actually land. Gated on total_calls so a brand-new
  // install isn't nagged before it's earned anything worth collecting.
  const needsPayout = !state.payout_email && state.total_calls >= 5;
  return json({ line: state.current_line, kind: state.current_kind, needs_payout: needsPayout });
}

async function handleEarnings(env, installId) {
  const raw = await env.INSTALLS.get(`install:${installId}`);
  const state = raw ? JSON.parse(raw) : defaultState();
  const revenue = (state.sponsor_calls + (state.bonus_calls || 0)) * (CPM / 1000);
  const inPromo = isInPromoWindow(state);
  const promoDaysLeft = inPromo
    ? Math.max(0, Math.ceil((PROMO_WINDOW_SECONDS - (Date.now() / 1000 - state.promo_started_at)) / 86400))
    : 0;
  return json({
    total_calls: state.total_calls,
    sponsor_calls: state.sponsor_calls,
    sponsor_ratio: sponsorRatio(state),
    gross_revenue: revenue,
    user_earnings: revenue * userShareFor(state),
    payout_email: state.payout_email || null,
    jackpot_won_total: state.jackpot_won_total || 0,
    name: state.name || null,
    promo_number: state.promo_number || null,
    promo_active: inPromo,
    promo_days_left: promoDaysLeft,
    daily_earnings: state.daily_earnings || {},
  });
}

/** A first name only, for the dashboard greeting -- nothing tied to
 * identity or payments (that's payout_email's job, with its own
 * change-confirmation guard above). Since there's nothing sensitive
 * to protect here, setting/overwriting it is open the same way a
 * first-time payout_email is: no confirmation dance needed. */
const NAME_MAX_LEN = 40;
async function handleSetName(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { id, name } = data;
  if (!id || !name) return json({ error: "missing id or name" }, 400);
  if (!isValidId(id)) return json({ error: "invalid id" }, 400);
  const trimmed = String(name).trim();
  if (!trimmed || /[<>]/.test(trimmed)) return json({ error: "invalid name" }, 400);

  const key = `install:${id}`;
  const state = await getOrCreateState(env, id);
  state.name = trimmed.slice(0, NAME_MAX_LEN);
  // Same reasoning as handleLine's final write -- this is step one of
  // onboarding for a brand-new user. A write failure here (KV quota,
  // a transient outage) must not hard-block every new signup; worst
  // case the name doesn't stick and they're asked again next visit,
  // which is recoverable. A 500 here is not.
  try {
    await env.INSTALLS.put(key, JSON.stringify(state));
  } catch (e) {
    await logError(env, "install_state_write_failed", `set-name for install ${id} didn't persist`, e.message);
  }

  return json({ ok: true, name: state.name, promo_number: state.promo_number || null });
}

/** Shields.io-style embeddable SVG badge -- "prove your earnings are
 * real" for a GitHub README/profile. Deliberately public and
 * unauthenticated, same posture as /earnings: the install ID is
 * already the only "auth" this whole system has, and a badge is
 * explicitly meant to be shown to strangers, so there's nothing new
 * to protect by locking this down. Reuses the exact same earnings
 * math as /earnings rather than recomputing it a second way, so the
 * two can never silently drift apart. Cached at the edge for 5
 * minutes -- a badge embedded in a popular README could get hit far
 * more often than a real user ever checks their own earnings, and a
 * badge doesn't need to be second-accurate. */
function estimateBadgeTextWidth(text) {
  return Math.round(text.length * 6.5);
}

function escapeSvgText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function badgeSvg(label, value, valueColor) {
  const pad = 10;
  const labelWidth = estimateBadgeTextWidth(label) + pad * 2;
  const valueWidth = estimateBadgeTextWidth(value) + pad * 2;
  const totalWidth = labelWidth + valueWidth;
  const labelX = labelWidth / 2;
  const valueX = labelWidth + valueWidth / 2;
  const labelEsc = escapeSvgText(label);
  const valueEsc = escapeSvgText(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${labelEsc}: ${valueEsc}">
<title>${labelEsc}: ${valueEsc}</title>
<linearGradient id="s" x2="0" y2="100%">
<stop offset="0" stop-color="#fff" stop-opacity=".08"/>
<stop offset="1" stop-opacity=".08"/>
</linearGradient>
<clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${labelWidth}" height="20" fill="#0d0d10"/>
<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${valueColor}"/>
<rect width="${totalWidth}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
<text x="${labelX}" y="14" fill="#000" fill-opacity=".3">${labelEsc}</text>
<text x="${labelX}" y="13">${labelEsc}</text>
<text x="${valueX}" y="14" fill="#000" fill-opacity=".3">${valueEsc}</text>
<text x="${valueX}" y="13" fill="#0d0d10">${valueEsc}</text>
</g>
</svg>`;
}

async function handleBadge(env, request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const cacheKey = new Request(new URL(`/badge?id=${encodeURIComponent(id || "")}`, url.origin).toString());
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let value = "install the client";
  let color = "#8c8c96";

  if (id && isValidId(id)) {
    const raw = await env.INSTALLS.get(`install:${id}`);
    if (raw) {
      const state = JSON.parse(raw);
      const revenue = (state.sponsor_calls + (state.bonus_calls || 0)) * (CPM / 1000);
      const earnings = revenue * userShareFor(state);
      value = `$${earnings.toFixed(2)}`;
      color = "#e8c896";
    } else {
      value = "no data yet";
    }
  }

  const svg = badgeSvg("meanwhile", value, color);
  const res = new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
  await cache.put(cacheKey, res.clone());
  return res;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The real client only ever generates a standard v4 UUID for install_id.
 * Validating the shape at every entry point rejects garbage before it
 * ever reaches KV -- found this the hard way: an oversized id crashed
 * with a raw KV error (caught by the top-level handler, but still a
 * 500 for something that should just be a clean 400), and a
 * path-traversal-looking id silently created a junk KV record. Neither
 * was exploitable, both were sloppy. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}
const PAYOUT_THRESHOLD_USD = 25;

/** The install ID alone is what /claim?id=... is built around -- and
 * that ID is meant to be shared (it's in a URL, it gets screenshotted,
 * pasted into chat, sits in browser history). That's fine for *viewing*
 * earnings, but if it were also sufficient to *redirect* an existing
 * payout destination, a leaked ID would let anyone silently steal
 * someone else's future payouts. So: setting a payout email for the
 * first time is open (there's nothing to protect yet), but changing an
 * already-registered one requires proving you know the current value
 * too -- an install ID alone is no longer enough once real money has a
 * real destination attached. */
/** register-payout is the cash-out step -- the one place a scripted fake
 * install (random UUID, faked-but-"progressing" session evidence to get
 * past sessionProgressed in handleLine) actually turns into real money
 * moving. Turnstile is the cheapest choke point: a human solves it once
 * per registration, a script can't. Fails open only while the secret
 * isn't configured yet (so the endpoint doesn't break before ops sets
 * it up) -- once TURNSTILE_SECRET_KEY exists, a missing/invalid token
 * is a hard reject, not a soft warning. */
async function checkTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true };
  if (!token) return { ok: false, reason: "verification required" };
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await res.json();
    if (!result.success) return { ok: false, reason: "verification failed -- try again" };
    return { ok: true };
  } catch {
    // Cloudflare's own verify endpoint being unreachable isn't the
    // registrant's fault -- fail open on transport errors, same as the
    // advertiser email check does on its own API's downtime.
    return { ok: true };
  }
}

async function handleRegisterPayout(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { id, email, current_email, turnstile_token } = data;
  if (!id || !email) return json({ error: "missing id or email" }, 400);
  if (!isValidId(id)) return json({ error: "invalid id" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "invalid email" }, 400);

  const turnstileResult = await checkTurnstile(turnstile_token, request.headers.get("CF-Connecting-IP"), env);
  if (!turnstileResult.ok) return json({ error: turnstileResult.reason }, 403);

  const key = `install:${id}`;
  const state = await getOrCreateState(env, id);

  if (state.payout_email && state.payout_email.toLowerCase() !== email.toLowerCase()) {
    if (!current_email || current_email.toLowerCase() !== state.payout_email.toLowerCase()) {
      await logError(env, "payout_email_change_blocked", `install ${id} tried to change payout email without confirming the current one`, `existing: ${state.payout_email}, attempted: ${email}`);
      return json({ error: "to change an already-registered payout email, you must also provide the current one" }, 403);
    }
  }

  state.payout_email = email;
  // Unlike handleLine's or set-name's writes, this one can't fail soft --
  // it's the actual money destination. Silently claiming "ok" while the
  // email never persisted would mean a real payout later has nowhere to
  // go, which is worse than an honest "try again" now. So this stays a
  // hard failure, just an accurate one instead of a raw KV error leaking
  // through the generic 500 handler.
  try {
    await env.INSTALLS.put(key, JSON.stringify(state));
  } catch (e) {
    await logError(env, "install_state_write_failed", `register-payout for install ${id} couldn't persist the email`, e.message);
    return json({ error: "couldn't save this right now -- try again in a few minutes" }, 503);
  }

  const revenue = (state.sponsor_calls + (state.bonus_calls || 0)) * (CPM / 1000);
  const earnings = revenue * userShareFor(state);
  return json({
    ok: true,
    email,
    current_earnings: earnings,
    payout_threshold: PAYOUT_THRESHOLD_USD,
    promo_number: state.promo_number || null,
  });
}

/** Sends one real PayPal payout to a developer's registered email, then
 * actually checks whether it landed instead of trusting the "batch
 * accepted" response -- PayPal accepts the batch immediately but the
 * real per-item outcome (SUCCESS / PENDING / UNCLAIMED / FAILED) only
 * shows up on a follow-up status check. A typo'd or non-PayPal email
 * doesn't error out at creation time; it just sits unclaimed. */
async function sendPayPalPayout(env, installId, email, amountUsd) {
  const token = await getPayPalToken(env);
  const res = await fetch(`${PAYPAL_API}/v1/payments/payouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: `meanwhile-${installId}-${Date.now()}`,
        email_subject: "Your Meanwhile earnings",
        email_message: "Thanks for running Meanwhile -- here's your share of sponsor revenue.",
      },
      items: [{
        recipient_type: "EMAIL",
        amount: { value: amountUsd.toFixed(2), currency: "USD" },
        receiver: email,
        note: "Meanwhile status-line sponsor earnings",
        sender_item_id: installId,
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `payout failed: ${res.status}`);

  const batchId = data.batch_header?.payout_batch_id;
  let itemStatus = "UNKNOWN";
  if (batchId) {
    // PayPal settles most items within a couple seconds; a short poll
    // (not a blind assumption) is enough to catch outright failures.
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await fetch(`${PAYPAL_API}/v1/payments/payouts/${batchId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!statusRes.ok) continue;
      const statusData = await statusRes.json();
      const item = statusData.items?.[0];
      if (item && item.transaction_status && item.transaction_status !== "PENDING") {
        itemStatus = item.transaction_status;
        break;
      }
      itemStatus = item?.transaction_status || itemStatus;
    }
  }
  return { ...data, item_status: itemStatus };
}

const PAYOUT_LOCK_KEY = "payout_sweep_lock";
const PAYOUT_LOCK_TTL_SECONDS = 600;

/** The real payout sweep: scans every install, and for anyone whose
 * unpaid balance has crossed the threshold, actually sends the money.
 * paid_out_usd tracks what's already been sent so nobody gets double-paid
 * on the next run. Called both by the manual admin endpoint and by the
 * scheduled() cron trigger -- same one real algorithm, two triggers.
 *
 * That "two triggers" is exactly the danger: if a manual /admin/run-payouts
 * call ever overlaps with the daily cron (or two manual calls overlap),
 * both invocations would read the same paid_out_usd before either writes
 * it back -- real double payments, real money, sent twice. KV has no
 * compare-and-swap, so a plain check-then-set lock still has a real gap
 * (verified live: two truly concurrent calls both see no lock and both
 * proceed). Closing that as tightly as KV allows: write a unique token,
 * wait, then re-read and only continue if the value read back is still
 * the exact token this call wrote. If another run's write landed in
 * that window, this call sees a different value and backs off instead
 * of both proceeding. Not a cryptographic guarantee -- Durable Objects
 * would be the airtight version -- but this closes the realistic gap
 * (two calls within a fraction of a second of each other) rather than
 * leaving it wide open, and this endpoint is admin-token-gated and
 * human-triggered, not something under adversarial pressure. */
async function runPayouts(env) {
  const myToken = crypto.randomUUID();
  const existingLock = await env.INSTALLS.get(PAYOUT_LOCK_KEY);
  if (existingLock) {
    return { ok: false, error: "payout sweep already in progress", locked_at: existingLock };
  }
  await env.INSTALLS.put(PAYOUT_LOCK_KEY, myToken, { expirationTtl: PAYOUT_LOCK_TTL_SECONDS });
  await new Promise((r) => setTimeout(r, 250));
  const confirmedLock = await env.INSTALLS.get(PAYOUT_LOCK_KEY);
  if (confirmedLock !== myToken) {
    return { ok: false, error: "payout sweep already in progress (lost race)", locked_at: confirmedLock };
  }
  try {
    return await runPayoutsLocked(env);
  } finally {
    await env.INSTALLS.delete(PAYOUT_LOCK_KEY);
  }
}

/** The product's own stated model is one person = one install ID,
 * shared across every tool they connect (terms.html says as much). So
 * the same payout email legitimately paying out from more than a
 * couple of *different* install IDs is already outside how the system
 * is supposed to be used -- exactly the shape a script minting fake
 * UUIDs and routing them all to one real email would produce. Generous
 * on purpose (a shared family machine, a lost-and-reinstalled ID) --
 * this flags for manual review rather than hard-blocking, since a false
 * positive here means a real developer's real money gets held, not
 * just delayed. */
const MAX_PAID_INSTALLS_PER_EMAIL = 3;
function payeeKey(email) {
  return `payee_installs:${email.toLowerCase()}`;
}
async function getPaidInstallsForEmail(env, email) {
  const raw = await env.INSTALLS.get(payeeKey(email));
  return raw ? JSON.parse(raw) : [];
}
async function recordPaidInstallForEmail(env, email, installId) {
  const ids = await getPaidInstallsForEmail(env, email);
  if (!ids.includes(installId)) {
    ids.push(installId);
    await env.INSTALLS.put(payeeKey(email), JSON.stringify(ids));
  }
}

/** Informational only -- a real install can legitimately run near-100%
 * sponsor fill whenever advertiser demand is high, so this can't be a
 * hard block without risking real users' payouts. But it's exactly the
 * signature a scripted fake install produces (every billable call lands
 * as "sponsor" since there's no real tip/sponsor mix from genuine
 * variable usage), so it's worth a human glancing at before or after
 * the money moves, not worth blocking on its own. */
const SPONSOR_RATIO_ALERT_THRESHOLD = 0.97;
const SPONSOR_RATIO_ALERT_MIN_CALLS = 30;

async function runPayoutsLocked(env) {
  const results = [];
  let cursor;
  do {
    const page = await env.INSTALLS.list({ prefix: "install:", cursor });
    for (const key of page.keys) {
      const raw = await env.INSTALLS.get(key.name);
      if (!raw) continue;
      const state = JSON.parse(raw);
      if (!state.payout_email) continue;

      const revenue = (state.sponsor_calls + (state.bonus_calls || 0)) * (CPM / 1000);
      const earnings = revenue * userShareFor(state);
      const unpaid = earnings - (state.paid_out_usd || 0);
      if (unpaid < PAYOUT_THRESHOLD_USD) continue;

      const installId = key.name.replace(/^install:/, "");
      const ratio = sponsorRatio(state);
      if (ratio >= SPONSOR_RATIO_ALERT_THRESHOLD && state.total_calls >= SPONSOR_RATIO_ALERT_MIN_CALLS) {
        await logError(env, "sponsor_ratio_anomaly", `install ${installId} is at ${(ratio * 100).toFixed(1)}% sponsor fill over ${state.total_calls} calls, about to pay $${unpaid.toFixed(2)}`, `payout_email: ${state.payout_email}`);
      }

      const paidInstallsForEmail = await getPaidInstallsForEmail(env, state.payout_email);
      if (!paidInstallsForEmail.includes(installId) && paidInstallsForEmail.length >= MAX_PAID_INSTALLS_PER_EMAIL) {
        results.push({ install_id: installId, email: state.payout_email, amount: unpaid, status: "held_for_review", detail: "email already paid out from too many other install IDs" });
        await logError(env, "payout_held_email_cap", `install ${installId} held -- ${state.payout_email} already has ${paidInstallsForEmail.length} other paid-out install IDs (cap ${MAX_PAID_INSTALLS_PER_EMAIL})`, JSON.stringify(paidInstallsForEmail));
        continue;
      }

      try {
        const outcome = await sendPayPalPayout(env, installId, state.payout_email, unpaid);
        const status = outcome.item_status;

        if (status === "FAILED" || status === "BLOCKED" || status === "DENIED") {
          // Money never left the sender's balance -- do NOT mark as paid,
          // so the sweep retries this install automatically next run.
          results.push({ install_id: installId, email: state.payout_email, amount: unpaid, status: "failed", detail: status });
          await logError(env, "payout_rejected", `payout of $${unpaid.toFixed(2)} to install ${installId} (${state.payout_email})`, `PayPal status: ${status}`);
          continue;
        }

        // SUCCESS, PENDING, or UNCLAIMED all mean funds actually left the
        // sender's balance -- mark paid either way, but flag anything
        // that isn't a clean SUCCESS for manual follow-up so a typo'd
        // email doesn't just silently vanish from view.
        state.paid_out_usd = (state.paid_out_usd || 0) + unpaid;
        state.last_payout_at = Date.now() / 1000;
        state.last_payout_status = status;
        await env.INSTALLS.put(key.name, JSON.stringify(state));
        await recordPaidInstallForEmail(env, state.payout_email, installId);
        results.push({ install_id: installId, email: state.payout_email, amount: unpaid, status: "sent", detail: status });
        if (status !== "SUCCESS") {
          await logError(env, "payout_needs_review", `payout of $${unpaid.toFixed(2)} to install ${installId} (${state.payout_email}) is not a confirmed SUCCESS`, `PayPal status: ${status} -- check if the email is actually a real PayPal account`);
        }
      } catch (e) {
        results.push({ install_id: installId, email: state.payout_email, amount: unpaid, status: "failed", error: e.message });
        await logError(env, "payout_failed", `payout of $${unpaid.toFixed(2)} to install ${installId} failed`, e.message);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return { ok: true, processed: results.length, results };
}

/** One-way hash for the public jackpot log -- winners are identified by
 * this, never by their raw install ID. That ID is effectively a
 * password (it's what /register-payout trusts), so publishing it next
 * to "this person just won $X" would be handing out exactly what's
 * needed to try hijacking their payout destination. */
async function hashForPublicLog(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Every install with a registered payout email and real usage (not a
 * fresh test install doing nothing) is a candidate. Uses real
 * cryptographic randomness, not Math.random -- this is a public,
 * independently-checkable draw, not an internal implementation detail. */
async function pickJackpotWinner(env) {
  const eligible = [];
  let cursor;
  do {
    const page = await env.INSTALLS.list({ prefix: "install:", cursor });
    for (const key of page.keys) {
      const raw = await env.INSTALLS.get(key.name);
      if (!raw) continue;
      const state = JSON.parse(raw);
      if (state.payout_email && state.total_calls >= JACKPOT_MIN_CALLS) {
        eligible.push({ installId: key.name.replace(/^install:/, ""), email: state.payout_email });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  if (eligible.length === 0) return null;

  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0];
  const index = randomValue % eligible.length;
  return { winner: eligible[index], candidateCount: eligible.length, randomValue, index };
}

/** The actual monthly draw. Guarded so it can only ever run once per
 * calendar month (checked via jackpot:last_draw_month), whether it's
 * triggered by the daily cron landing on the 1st or a manual admin
 * call. Every exit path is honest about what happened -- skipped for
 * too small a pool, skipped for no eligible winner, or a real payout --
 * never a silent no-op that looks like success. */
async function runJackpotDraw(env) {
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const lastDrawMonth = await env.CAMPAIGNS.get("jackpot:last_draw_month");
  if (lastDrawMonth === monthKey) {
    return { ok: true, skipped: "already drawn this month" };
  }

  const ledger = await getHouseLedger(env);
  if (ledger.availablePool < JACKPOT_MIN_POOL_USD) {
    await env.CAMPAIGNS.put("jackpot:last_draw_month", monthKey);
    await logError(env, "jackpot_skipped", `no draw this month -- pool is $${ledger.availablePool.toFixed(2)}, needs at least $${JACKPOT_MIN_POOL_USD}`, JSON.stringify(ledger));
    return { ok: true, skipped: "pool too small", pool_usd: ledger.availablePool };
  }

  const draw = await pickJackpotWinner(env);
  if (!draw) {
    await env.CAMPAIGNS.put("jackpot:last_draw_month", monthKey);
    await logError(env, "jackpot_skipped", "no eligible installs this month", `pool was $${ledger.availablePool.toFixed(2)}, just no one qualified`);
    return { ok: true, skipped: "no eligible installs" };
  }

  const amount = Math.min(JACKPOT_MAX_PAYOUT_USD, Math.round(ledger.availablePool * JACKPOT_PAYOUT_FRACTION * 100) / 100);

  let outcome;
  try {
    outcome = await sendPayPalPayout(env, draw.winner.installId, draw.winner.email, amount);
  } catch (e) {
    await logError(env, "jackpot_payout_failed", `jackpot payout of $${amount} to install ${draw.winner.installId}`, e.message);
    return { ok: false, error: e.message };
  }

  const status = outcome.item_status;
  if (status === "FAILED" || status === "BLOCKED" || status === "DENIED") {
    // Don't mark the month as drawn -- money never left, so this isn't
    // really "this month's draw" happening yet. Next check (tomorrow's
    // cron) will just try again against a still-healthy pool.
    await logError(env, "jackpot_payout_rejected", `jackpot payout of $${amount} to install ${draw.winner.installId} (${draw.winner.email})`, `PayPal status: ${status}`);
    return { ok: false, error: "payout rejected", detail: status };
  }

  await env.CAMPAIGNS.put("jackpot:last_draw_month", monthKey);
  await adjustHouseLedger(env, "jackpot_paid_total", amount);

  // Deliver the win through the exact same channel as a tip or sponsor
  // line -- the winner finds out mid-keystroke, not by email first.
  // pickLine checks for and clears this the very next time they're
  // shown a line.
  const winnerKey = `install:${draw.winner.installId}`;
  const winnerRaw = await env.INSTALLS.get(winnerKey);
  const winnerState = winnerRaw ? JSON.parse(winnerRaw) : defaultState();
  winnerState.pending_jackpot_win = { amount, at: Date.now() / 1000 };
  winnerState.jackpot_won_total = (winnerState.jackpot_won_total || 0) + amount;
  await env.INSTALLS.put(winnerKey, JSON.stringify(winnerState));

  // Public, verifiable record: the exact random value and candidate
  // count are published so anyone can check the draw was actually fair,
  // not just told to trust it. Winner shown only as a one-way hash.
  const winnerHash = await hashForPublicLog(draw.winner.installId);
  const record = {
    id: crypto.randomUUID(),
    month: monthKey,
    amount_usd: amount,
    pool_before_usd: ledger.availablePool,
    candidate_count: draw.candidateCount,
    random_value: draw.randomValue,
    winner_index: draw.index,
    winner_hash: winnerHash,
    payout_status: status,
    at: Date.now() / 1000,
  };
  await env.CAMPAIGNS.put(`jackpot:draw:${record.id}`, JSON.stringify(record));
  const historyRaw = await env.CAMPAIGNS.get("jackpot:history");
  const history = historyRaw ? JSON.parse(historyRaw) : [];
  history.unshift(record.id);
  if (history.length > 60) history.length = 60;
  await env.CAMPAIGNS.put("jackpot:history", JSON.stringify(history));

  return { ok: true, record };
}

async function handleJackpotHistory(env) {
  const historyRaw = await env.CAMPAIGNS.get("jackpot:history");
  const ids = historyRaw ? JSON.parse(historyRaw) : [];
  const draws = [];
  for (const id of ids) {
    const raw = await env.CAMPAIGNS.get(`jackpot:draw:${id}`);
    if (raw) draws.push(JSON.parse(raw));
  }
  const ledger = await getHouseLedger(env);
  return json({ draws, current_pool_usd: Math.max(0, ledger.availablePool) });
}

const HEARTBEAT_ACTIVE_WINDOW_SECONDS = 60 * 60 * 24; // "active today" = a real line shown in the last 24h

/** ---- The Heartbeat ----
 * Once a day, at a genuinely unpredictable moment, every install that's
 * been real-active in the last 24h gets tagged at the exact same instant.
 * Worth being honest about what this actually is: there's no push
 * channel to a CLI status line, only request/response, so this can't
 * make two people SEE the line at literally the same second -- what's
 * actually true, and what the line itself says, is that the message
 * went out to everyone at the same instant, and each person sees it the
 * next time their own agent pauses. That's still real, just correctly
 * scoped -- the brand's whole premise is not overselling what's true.
 *
 * The exact firing moment is chosen with a classic uniform-random-
 * stopping-time trick: this runs on the existing 20-min cron, and each
 * tick fires with probability 1/(ticks remaining today). That
 * guarantees it fires exactly once per day while keeping the specific
 * moment genuinely unpredictable, not just "some random-looking hour
 * that's actually the same window every time." */
async function maybeFireHeartbeat(env) {
  const today = todayUTC();
  const lastFired = await env.INSTALLS.get("heartbeat:last_fired_date");
  if (lastFired === today) return;

  const now = new Date();
  const minutesSinceMidnightUTC = now.getUTCHours() * 60 + now.getUTCMinutes();
  const ticksRemainingToday = Math.max(1, Math.ceil((1440 - minutesSinceMidnightUTC) / 20));
  if (Math.random() >= 1 / ticksRemainingToday) return;

  await env.INSTALLS.put("heartbeat:last_fired_date", today);
  await fireHeartbeat(env);
}

async function fireHeartbeat(env) {
  const cutoff = Date.now() / 1000 - HEARTBEAT_ACTIVE_WINDOW_SECONDS;
  const activeKeys = [];
  let cursor;
  do {
    const page = await env.INSTALLS.list({ prefix: "install:", cursor });
    for (const key of page.keys) {
      const raw = await env.INSTALLS.get(key.name);
      if (!raw) continue;
      const state = JSON.parse(raw);
      if (state.total_calls > 0 && state.line_started && state.line_started >= cutoff) {
        activeKeys.push(key.name);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  if (activeKeys.length === 0) return;

  // Sequential, not concurrent -- a real /line call for the same install
  // landing in this same moment could still race this write and whichever
  // one lands last wins. Accepted as-is: the only consequence of losing
  // that race is one install misses today's heartbeat, which is genuinely
  // harmless (no money, no state anyone depends on) -- not worth a lock
  // for a purely ambient feature.
  for (const key of activeKeys) {
    const raw = await env.INSTALLS.get(key);
    if (!raw) continue;
    const state = JSON.parse(raw);
    state.pending_heartbeat = { at: Date.now() / 1000, network_size: activeKeys.length };
    await env.INSTALLS.put(key, JSON.stringify(state));
  }

  await logError(env, "heartbeat_fired", `sent to ${activeKeys.length} active install(s)`, "");
}

/** Creates a real campaign in "pending_payment" -- not yet in rotation.
 * It only starts serving once an admin (or, later, a real payment webhook)
 * calls /admin/activate-campaign. That's the actual activation algorithm:
 * status flips to "active", and the very next /line call across the whole
 * network can pick it up -- no deploy, no manual code change needed. */
const LEAD_RATE_LIMIT = 5;
const LEAD_RATE_WINDOW_SECONDS = 3600;

/** Just proved live that this endpoint had zero friction -- five rapid
 * submissions, all 200, no payment required for any of them. Beyond
 * the obvious spam/clutter, each one is a permanent CAMPAIGNS entry
 * that the reconciliation sweep's self-healing list() scan iterates
 * over forever, and list() is the exact resource that already hit a
 * real daily quota wall once tonight. Reusing the LEADS namespace for
 * this -- it's bound in wrangler.toml but was otherwise completely
 * unused. KV's native TTL expiration makes this genuinely free
 * cleanup, no cron needed. */
// Same fail-open reasoning as checkLineRateLimit -- a rate limiter's own
// KV read/write breaking (quota exhaustion, a transient outage) must
// never itself block the real request it's guarding. Found live: this
// exact gap was crashing verify-advertiser -- the FIRST step of the
// advertiser signup form -- for every new advertiser while KV writes
// were failing account-wide, blocking real paying customers from ever
// reaching the payment step.
async function checkLeadRateLimit(env, ip) {
  const key = `ratelimit:lead:${ip}`;
  try {
    const raw = await env.LEADS.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= LEAD_RATE_LIMIT) return false;
    await env.LEADS.put(key, String(count + 1), { expirationTtl: LEAD_RATE_WINDOW_SECONDS });
  } catch (e) {
    await logError(env, "lead_rate_limit_check_failed", `rate limit check for ${ip} failed open`, e.message);
  }
  return true;
}

/** /line is the hottest endpoint in the app by a wide margin -- every
 * real event from every real running install hits it, event-driven with
 * no refreshInterval (see handleLine), so genuine usage realistically
 * never approaches more than a handful of calls a minute even from
 * someone coding hard. Scoped to install ID only, on purpose: install
 * IDs are unique UUIDs, so concurrent requests for different installs
 * never collide on the same KV key. An earlier version of this also
 * kept a per-IP counter -- one shared key written on every single call
 * from that IP -- which sounds fine until enough concurrent traffic
 * from one IP (an office network, a VPN, or just a burst of real
 * requests) hits Cloudflare KV's own ~1-write/sec-per-key ceiling and
 * the writes themselves start failing with real 500s. Caught live via
 * a 25-request concurrent stress test against this exact endpoint --
 * every failure was "KV PUT failed: 429 Too Many Requests" on that one
 * shared key, not anything about the rate-limit logic itself. Per-
 * install keys don't have this problem since no two different installs
 * ever write the same key, and the install-level cap already covers
 * the main threat (one fake install hammered). The "many fake installs
 * from one IP" case is still bounded elsewhere -- Turnstile on cash-out,
 * the monotonic sessionProgressed check, and the per-email payout cap
 * all sit downstream of this and don't share this hot-key problem. */
const LINE_RATE_LIMIT_PER_INSTALL = 40;
const LINE_RATE_WINDOW_PER_INSTALL_SECONDS = 60;

async function checkLineRateLimit(env, installId) {
  const installKey = `ratelimit:line:install:${installId}`;
  // This check runs before handleLine even starts, so an unguarded
  // failure here would crash /line entirely -- worse than the thing
  // it's meant to protect against. If KV itself can't be read or
  // written to right now (quota exhaustion, a transient outage), fail
  // open: let the real line through uncounted rather than block every
  // real user because the rate limiter's own bookkeeping broke.
  try {
    const installRaw = await env.LEADS.get(installKey);
    const installCount = installRaw ? parseInt(installRaw, 10) : 0;
    if (installCount >= LINE_RATE_LIMIT_PER_INSTALL) {
      return { ok: false };
    }
    await env.LEADS.put(installKey, String(installCount + 1), { expirationTtl: LINE_RATE_WINDOW_PER_INSTALL_SECONDS });
  } catch (e) {
    await logError(env, "line_rate_limit_check_failed", `rate limit check for install ${installId} failed open`, e.message);
  }
  return { ok: true };
}

const VERIFY_RATE_LIMIT = 10;
const VERIFY_RATE_WINDOW_SECONDS = 3600;

/** Same KV-TTL rate-limit pattern as checkLeadRateLimit, separate key
 * prefix -- Abstract API's free tier is only 100 checks/month, so this
 * endpoint needs its own tighter cap or a handful of bots could burn
 * the whole month's quota in minutes. */
async function checkVerifyRateLimit(env, ip) {
  const key = `ratelimit:verify:${ip}`;
  try {
    const raw = await env.LEADS.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= VERIFY_RATE_LIMIT) return false;
    await env.LEADS.put(key, String(count + 1), { expirationTtl: VERIFY_RATE_WINDOW_SECONDS });
  } catch (e) {
    await logError(env, "verify_rate_limit_check_failed", `rate limit check for ${ip} failed open`, e.message);
  }
  return true;
}

/** Real checks, not just format validation -- format-valid doesn't mean
 * real (https://imgonnakillmeanwhile.com parses fine and isn't a real
 * business). URL: fetch it live, confirm the domain actually resolves
 * and serves something. Email: Abstract API's Email Reputation product,
 * which does a real SMTP-level check against the receiving mail server
 * (confirmed working even against Gmail) plus disposable/fake-domain
 * detection. */
async function handleVerifyAdvertiser(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await checkVerifyRateLimit(env, ip);
  if (!allowed) {
    return json({ error: `too many verification attempts -- try again in under an hour (limit: ${VERIFY_RATE_LIMIT}/hour)` }, 429);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { url: rawUrl, email } = data;
  if (!rawUrl || !email) {
    return json({ error: "missing url or email" }, 400);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    return json({ url_ok: false, url_reason: "not a valid, complete URL", email_ok: null, email_reason: null });
  }

  const [urlResult, emailResult] = await Promise.all([
    checkUrlIsLive(parsedUrl.toString()),
    checkEmailIsReal(email, env),
  ]);

  return json({
    url_ok: urlResult.ok,
    url_reason: urlResult.reason,
    email_ok: emailResult.ok,
    email_reason: emailResult.reason,
  });
}

async function checkUrlIsLive(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    let res;
    try {
      res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    } catch {
      // Some servers reject HEAD outright -- fall back to a real GET
      // before concluding the site is unreachable.
      res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    clearTimeout(timeout);
    if (res.status >= 200 && res.status < 500) {
      return { ok: true, reason: null };
    }
    return { ok: false, reason: `site responded with ${res.status}` };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, reason: "couldn't reach this site -- check the URL is live" };
  }
}

async function checkEmailIsReal(email, env) {
  if (!env.ABSTRACT_API_KEY) {
    // Key not configured -- fail open rather than blocking every advertiser
    // because of an ops gap. Format was already checked client-side.
    return { ok: true, reason: null };
  }
  try {
    const apiUrl = `https://emailreputation.abstractapi.com/v1/?api_key=${env.ABSTRACT_API_KEY}&email=${encodeURIComponent(email)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return { ok: true, reason: null }; // fail open on API-side errors
    }
    const result = await res.json();
    if (result?.email_quality?.is_disposable === true) {
      return { ok: false, reason: "disposable/temporary email addresses aren't allowed" };
    }
    const status = result?.email_deliverability?.status;
    if (status === "undeliverable") {
      return { ok: false, reason: "this mailbox doesn't appear to exist" };
    }
    // "deliverable" or "unknown" -- unknown means the API genuinely
    // couldn't determine mailbox existence (rare), treat as a pass
    // rather than blocking a legitimate advertiser on an inconclusive
    // signal.
    return { ok: true, reason: null };
  } catch {
    return { ok: true, reason: null }; // fail open on timeout/network error
  }
}

async function handleAdvertiserLead(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const allowed = await checkLeadRateLimit(env, ip);
  if (!allowed) {
    return json({ error: `too many submissions -- try again in under an hour (limit: ${LEAD_RATE_LIMIT}/hour)` }, 429);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const required = ["line", "url", "company", "email"];
  if (!required.every((k) => data[k])) {
    return json({ error: "missing fields" }, 400);
  }
  // Defense in depth: this data ends up rendered on a real page
  // (dashboard.html), which HTML-escapes it -- but that only holds if
  // every future rendering surface remembers to. Reject the actual
  // attack vector at the source too. Legitimate ad copy or a company
  // name never needs angle brackets.
  if (["line", "company", "url"].some((k) => /[<>]/.test(data[k]))) {
    return json({ error: "line, company, and url can't contain < or >" }, 400);
  }
  // Found by testing, not reading: neither field was validated at all --
  // a garbage email meant no way to ever reach a paying advertiser, and
  // a garbage url meant a real, paid, "working" campaign whose sponsor
  // line points nowhere in a real developer's real terminal.
  if (!EMAIL_RE.test(data.email)) {
    return json({ error: "invalid email" }, 400);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(data.url);
  } catch {
    return json({ error: "url must be a valid, complete URL (e.g. https://example.com)" }, 400);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return json({ error: "url must start with http:// or https://" }, 400);
  }
  // Pay whatever you want, get impressions computed from it -- no fixed
  // tiers, no artificial block sizes. Just enough sanitizing to keep the
  // number real: a positive, finite dollar amount, not NaN/Infinity/
  // negative from a malformed or hostile request.
  const amountUsd = Math.round(parseFloat(data.amount_usd) * 100) / 100;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return json({ error: "amount_usd must be a positive number" }, 400);
  }
  const impressionsTotal = Math.round((amountUsd / USD_PER_BLOCK) * IMPRESSIONS_PER_BLOCK);

  const id = crypto.randomUUID();
  const campaign = {
    id,
    line: String(data.line).slice(0, 60),
    url: String(data.url).slice(0, 300),
    company: String(data.company).slice(0, 100),
    email: String(data.email).slice(0, 200),
    price_usd: amountUsd,
    impressions_total: impressionsTotal,
    impressions_delivered: 0,
    daily_impressions: {},
    status: "pending_payment",
    created_at: Date.now() / 1000,
    activated_at: null,
  };

  await env.CAMPAIGNS.put(`campaign:${id}`, JSON.stringify(campaign));

  const indexed = await updateCampaignIndex(env, (index) => {
    if (!index.includes(id)) index.push(id);
    return index;
  }, (index) => index.includes(id));
  if (!indexed) {
    await logError(env, "campaign_index_write_failed", `campaign ${id} (${campaign.company}) saved but never confirmed in the index after retries`, `campaign:${id} itself is safe -- will self-heal on the next reconciliation sweep, or check manually`);
  }

  return json({ ok: true, campaign_id: id, price_usd: campaign.price_usd });
}

function checkAdmin(request, env) {
  const token = request.headers.get("X-Admin-Token");
  return token && env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

/** Shared by both the manual admin endpoint and the automatic PayPal
 * capture handler -- this is the one real activation algorithm, called
 * from two different triggers. */
async function activateCampaign(env, campaignId, paypalCaptureId) {
  const key = `campaign:${campaignId}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return null;
  const campaign = JSON.parse(raw);
  campaign.status = "active";
  campaign.activated_at = Date.now() / 1000;
  // Terms promises a pro-rated refund for undelivered impressions --
  // that's meaningless without the one thing PayPal's Refunds API
  // actually needs to act on a specific payment. Never stored before;
  // even a fully manual refund would've meant hunting through PayPal's
  // own transaction history to find the matching payment.
  if (paypalCaptureId) campaign.paypal_capture_id = paypalCaptureId;
  await env.CAMPAIGNS.put(key, JSON.stringify(campaign));
  // Only a REAL captured payment adds to the house ledger -- a manual
  // admin activation (no captureId, used for testing) never touches it,
  // so the jackpot pool can never be inflated by anything that wasn't
  // actual money in the door.
  if (paypalCaptureId) {
    await adjustHouseLedger(env, "house_revenue_total", campaign.price_usd);
  }
  return campaign;
}

async function handleActivateCampaign(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { campaign_id } = data;
  if (!campaign_id) return json({ error: "missing campaign_id" }, 400);

  const campaign = await activateCampaign(env, campaign_id);
  if (!campaign) return json({ error: "not found" }, 404);
  return json({ ok: true, campaign });
}

/** The Terms page promises a specific, calculable thing: a pro-rated
 * refund for undelivered impressions, computed from the same
 * impressions_delivered/impressions_total numbers shown on the
 * dashboard. Until now there was zero code behind that promise --
 * this is what actually keeps it. Real PayPal Refunds API call against
 * the real capture, real pro-rated math, not a manual "figure it out
 * yourself in the PayPal dashboard" process. */
async function handleRefundCampaign(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { campaign_id } = data;
  if (!campaign_id) return json({ error: "missing campaign_id" }, 400);

  const key = `campaign:${campaign_id}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return json({ error: "campaign not found" }, 404);
  const campaign = JSON.parse(raw);

  if (campaign.status === "refunded") {
    return json({ error: "already refunded" }, 409);
  }
  if (!campaign.paypal_capture_id) {
    return json({ error: "no capture id on file for this campaign -- refund it manually in the PayPal dashboard, then mark it refunded yourself" }, 422);
  }
  if (campaign.impressions_delivered >= campaign.impressions_total) {
    return json({ error: "fully delivered -- nothing left to refund" }, 409);
  }

  const undeliveredFraction = (campaign.impressions_total - campaign.impressions_delivered) / campaign.impressions_total;
  const refundAmount = Math.round(campaign.price_usd * undeliveredFraction * 100) / 100;
  if (refundAmount <= 0) return json({ error: "calculated refund amount is $0" }, 409);

  let token;
  try {
    token = await getPayPalToken(env);
  } catch (e) {
    await logError(env, "paypal_auth_failed", `refund for campaign ${campaign_id}`, e.message);
    return json({ error: "paypal auth failed" }, 502);
  }

  const refundRes = await fetch(`${PAYPAL_API}/v2/payments/captures/${campaign.paypal_capture_id}/refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: { value: refundAmount.toFixed(2), currency_code: "USD" },
      note_to_payer: `Meanwhile: pro-rated refund for ${campaign.impressions_total - campaign.impressions_delivered} of ${campaign.impressions_total} undelivered impressions`,
    }),
  });
  const refund = await refundRes.json();
  if (!refundRes.ok || refund.status !== "COMPLETED") {
    await logError(env, "refund_failed", `campaign ${campaign_id}, capture ${campaign.paypal_capture_id}`, JSON.stringify(refund));
    return json({ error: "refund failed", detail: refund }, 502);
  }

  campaign.status = "refunded";
  campaign.refunded_at = Date.now() / 1000;
  campaign.refund_amount_usd = refundAmount;
  campaign.paypal_refund_id = refund.id;
  await env.CAMPAIGNS.put(key, JSON.stringify(campaign));

  // That money actually left the account back to the advertiser -- the
  // house ledger has to shrink to match, or the jackpot pool would be
  // funded partly by revenue that was given back.
  await adjustHouseLedger(env, "house_revenue_total", -refundAmount);

  return json({ ok: true, campaign, refund_amount_usd: refundAmount });
}

/** Terms promises "we reserve the right to remove or refuse any
 * campaign that is illegal, deceptive, malicious, or sexually
 * explicit" -- and campaigns auto-activate the instant payment clears,
 * with no human review before real developers start seeing the line
 * in their real terminals. Until now there was no way to act on that
 * promise without also forcing an immediate refund decision through
 * PayPal -- two genuinely separate questions ("should this stop
 * showing right now" and "how much, if anything, do we owe back")
 * that shouldn't be coupled. This is the pure content lever: stops
 * delivery immediately, no money moves. */
async function handleSuspendCampaign(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { campaign_id } = data;
  if (!campaign_id) return json({ error: "missing campaign_id" }, 400);

  const key = `campaign:${campaign_id}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return json({ error: "campaign not found" }, 404);
  const campaign = JSON.parse(raw);
  if (campaign.status === "refunded") return json({ error: "already refunded" }, 409);

  campaign.status = "suspended";
  campaign.suspended_at = Date.now() / 1000;
  await env.CAMPAIGNS.put(key, JSON.stringify(campaign));
  return json({ ok: true, campaign });
}

/** The reverse -- for when a suspension turns out to be a false alarm
 * or the issue gets resolved, without needing to route back through
 * PayPal to "re-activate" something that was never actually refunded. */
async function handleResumeCampaign(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { campaign_id } = data;
  if (!campaign_id) return json({ error: "missing campaign_id" }, 400);

  const key = `campaign:${campaign_id}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return json({ error: "campaign not found" }, 404);
  const campaign = JSON.parse(raw);
  if (campaign.status !== "suspended") {
    return json({ error: `campaign is ${campaign.status}, not suspended -- nothing to resume` }, 409);
  }
  if (campaign.impressions_delivered >= campaign.impressions_total) {
    return json({ error: "fully delivered -- resuming would serve more than was paid for" }, 409);
  }

  campaign.status = "active";
  delete campaign.suspended_at;
  await env.CAMPAIGNS.put(key, JSON.stringify(campaign));
  return json({ ok: true, campaign });
}

/** Backs a real promise on the privacy page: "email us and we'll
 * remove your data." Before now that meant knowing the right raw
 * wrangler kv key delete incantation -- technically possible, not
 * real tooling. This is the real tooling: deletes the install's KV
 * record outright. The local install_id file, if it still exists on
 * their machine, would just get treated as a brand-new install on the
 * next real event (matches how the whole system already treats an
 * unknown ID -- defaultState(), nothing special needed here). */
async function handleDeleteInstall(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { id } = data;
  if (!id) return json({ error: "missing id" }, 400);
  if (!isValidId(id)) return json({ error: "invalid id" }, 400);

  await env.INSTALLS.delete(`install:${id}`);
  return json({ ok: true, deleted: id });
}

/** Same real promise, advertiser side. Doesn't touch CAMPAIGNS's
 * shared "index" key -- the campaign simply stops existing, and the
 * self-healing reconciliation sweep only ever ADDS missing entries to
 * the index, never removes them for existing ones, so a stale id
 * pointing at nothing just gets silently skipped everywhere it's
 * read (every read path already checks "if (!raw) continue/return"). */
async function handleDeleteCampaign(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { campaign_id } = data;
  if (!campaign_id) return json({ error: "missing campaign_id" }, 400);

  await env.CAMPAIGNS.delete(`campaign:${campaign_id}`);

  // Used to only delete the record and leave the ID sitting in "index"
  // forever -- getActiveCampaigns skips missing records safely, so
  // nothing broke, but every past deletion left a permanent ghost
  // behind. Confirmed live: 7 of 8 entries in the real index were
  // exactly this.
  const cleaned = await updateCampaignIndex(env, (index) => index.filter((id) => id !== campaign_id), (index) => !index.includes(campaign_id));
  if (!cleaned) {
    await logError(env, "campaign_index_removal_failed", `campaign ${campaign_id} deleted but its ID never confirmed removed from the index after retries`, "campaign record is gone -- getActiveCampaigns will skip it safely, but the index still has a ghost entry to clean up manually");
  }

  return json({ ok: true, deleted: campaign_id, index_cleaned: cleaned });
}

async function getPayPalToken(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`paypal auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

/** Creates a real PayPal order for a pending campaign. Moves no money --
 * an order only becomes a charge once the advertiser approves it on
 * PayPal's own page and we capture it afterward. */
async function handleCreatePayPalOrder(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { campaign_id } = data;
  if (!campaign_id) return json({ error: "missing campaign_id" }, 400);

  const key = `campaign:${campaign_id}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return json({ error: "campaign not found" }, 404);
  const campaign = JSON.parse(raw);
  if (campaign.status !== "pending_payment") {
    return json({ error: `campaign is already ${campaign.status}` }, 409);
  }

  let token;
  try {
    token = await getPayPalToken(env);
  } catch (e) {
    await logError(env, "paypal_auth_failed", `order creation for campaign ${campaign_id}`, e.message);
    return json({ error: "paypal auth failed" }, 502);
  }

  const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: campaign_id,
        description: `Meanwhile ad campaign: ${campaign.company}`,
        amount: { currency_code: "USD", value: campaign.price_usd.toFixed(2) },
      }],
      application_context: {
        brand_name: "Meanwhile",
        return_url: `${new URL(request.url).origin}/advertiser.html?paid=1&campaign_id=${campaign_id}`,
        cancel_url: `${new URL(request.url).origin}/advertiser.html?cancelled=1`,
      },
    }),
  });
  const order = await orderRes.json();
  if (!orderRes.ok) {
    await logError(env, "order_create_failed", `campaign ${campaign_id}`, JSON.stringify(order));
    return json({ error: order.message || "order creation failed" }, 502);
  }

  campaign.paypal_order_id = order.id;
  await env.CAMPAIGNS.put(key, JSON.stringify(campaign));

  const approveLink = (order.links || []).find((l) => l.rel === "approve" || l.rel === "payer-action");
  return json({ order_id: order.id, approval_url: approveLink ? approveLink.href : null });
}

/** Captures an approved PayPal order and activates the campaign, all in
 * one step -- this is the "payment automatically starts delivering"
 * mechanism. Only ever fires after a real advertiser has approved the
 * exact charge on PayPal's own page; this endpoint just finishes what
 * they already authorized. */
/** The one real capture+activate algorithm -- shared by the browser-
 * triggered endpoint below and the reconciliation sweep further down,
 * which exists specifically because the browser trigger alone isn't
 * reliable (advertiser closes the tab before the return URL loads,
 * loses connection, etc.). Either caller ends up here. */
async function captureAndActivateOrder(env, orderId) {
  const token = await getPayPalToken(env);

  const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const capture = await captureRes.json();
  if (!captureRes.ok || capture.status !== "COMPLETED") {
    return { ok: false, error: "capture failed", detail: capture };
  }

  const campaignId = capture.purchase_units?.[0]?.reference_id;
  if (!campaignId) {
    return { ok: false, error: "no reference_id on captured order", detail: capture };
  }
  const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;

  const activated = await activateCampaign(env, campaignId, captureId);
  if (!activated) {
    return { ok: false, error: "campaign not found for activation", detail: capture, moneyTaken: true };
  }
  if (!captureId) {
    await logError(env, "no_capture_id_on_completed_order", `campaign ${campaignId}, order ${orderId} -- captured successfully but no capture id found in the response, refunds for this campaign will need manual lookup in PayPal directly`, JSON.stringify(capture));
  }

  return { ok: true, campaign: activated };
}

async function handleCapturePayPalOrder(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { order_id } = data;
  if (!order_id) return json({ error: "missing order_id" }, 400);

  let result;
  try {
    result = await captureAndActivateOrder(env, order_id);
  } catch (e) {
    await logError(env, "paypal_auth_failed", `capture for order ${order_id}`, e.message);
    return json({ error: "paypal auth failed" }, 502);
  }

  if (!result.ok) {
    const category = result.moneyTaken ? "activation_failed_after_capture" : "capture_failed";
    const note = result.moneyTaken
      ? `order ${order_id} captured (money taken) but campaign not found for activation -- needs manual /admin/activate-campaign`
      : `order ${order_id}`;
    await logError(env, category, note, JSON.stringify(result.detail));
    return json({ error: result.error, detail: result.detail }, result.error === "capture failed" ? 502 : 500);
  }

  return json({ ok: true, campaign: result.campaign });
}

/** Reconciliation sweep: the browser-triggered capture above is the
 * happy path, not the only path. If an advertiser approves payment on
 * PayPal's page and then closes the tab, loses connection, or the
 * return redirect just glitches, PayPal has their money and the
 * campaign sits in "pending_payment" forever with nobody told. This
 * scans for exactly that state and finishes the job server-side --
 * same real algorithm as above, triggered by time instead of a
 * browser round-trip. Runs on the daily cron alongside payouts, and
 * on demand via /admin/reconcile-orders. */
async function reconcilePendingOrders(env) {
  // Self-heal the shared "index" key against the write race described
  // above the retry logic in handleAdvertiserLead: do a real KV list()
  // scan (safe here -- this runs every 20 min, not on every request, so
  // it doesn't touch the same quota risk that ruled out list() for the
  // hot /line path) and fold in any campaign key that exists but somehow
  // never made it into the index. This is cheap insurance and it means
  // reconciliation itself never misses a campaign just because the
  // index once got clobbered.
  const indexRaw = await env.CAMPAIGNS.get("index");
  const knownIds = new Set(indexRaw ? JSON.parse(indexRaw) : []);
  const missingIds = [];
  let cursor;
  do {
    const page = await env.CAMPAIGNS.list({ prefix: "campaign:", cursor });
    for (const key of page.keys) {
      const realId = key.name.replace(/^campaign:/, "");
      if (!knownIds.has(realId)) missingIds.push(realId);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const healedAny = missingIds.length > 0;
  if (healedAny) {
    // Used to be a single unprotected put here -- the exact same shared-
    // key race as everywhere else "index" gets written, just rarer since
    // this only runs every 20 min. Routes through the same retry-and-
    // verify helper now, re-reading the index fresh at write time rather
    // than trusting the copy read at the start of this scan (which could
    // be stale by the time a slow full campaign: scan finishes).
    await updateCampaignIndex(env, (index) => {
      const merged = new Set(index);
      for (const id of missingIds) merged.add(id);
      return [...merged];
    }, (index) => missingIds.every((id) => index.includes(id)));
    await logError(env, "campaign_index_healed", `reconciliation found campaign(s) missing from the index and added them back`, JSON.stringify(missingIds));
  }
  const ids = [...new Set([...knownIds, ...missingIds])];

  const results = [];
  let scanned = 0;

  for (const id of ids) {
    const raw = await env.CAMPAIGNS.get(`campaign:${id}`);
    if (!raw) continue;
    const campaign = JSON.parse(raw);
    if (campaign.status !== "pending_payment" || !campaign.paypal_order_id) continue;
    scanned++;

    try {
      const token = await getPayPalToken(env);
      const statusRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${campaign.paypal_order_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const orderData = await statusRes.json();
      if (!statusRes.ok) {
        results.push({ campaign_id: id, status: "order_lookup_failed", detail: orderData });
        continue;
      }

      if (orderData.status === "APPROVED") {
        // Advertiser approved on PayPal's page but the browser never
        // made it back to finish the job -- finish it now.
        const result = await captureAndActivateOrder(env, campaign.paypal_order_id);
        if (result.ok) {
          results.push({ campaign_id: id, status: "recovered_and_activated" });
        } else {
          await logError(env, "reconcile_capture_failed", `campaign ${id}, order ${campaign.paypal_order_id}`, JSON.stringify(result.detail));
          results.push({ campaign_id: id, status: "capture_retry_failed", detail: result.error });
        }
      } else if (orderData.status === "COMPLETED") {
        // Rare: PayPal shows it already captured but our activation
        // step never ran (e.g. the Worker died mid-request). Real money
        // already moved here -- found while auditing that this call was
        // missing the capture ID entirely, which meant this specific
        // recovery path would activate the campaign without ever
        // recording the payment in the house ledger (so it couldn't
        // fund the jackpot) and without ever setting
        // paypal_capture_id (so it could never be refunded through
        // handleRefundCampaign either, only by hand in the PayPal
        // dashboard). Same field path captureAndActivateOrder already
        // uses to pull it out of a capture response, works the same way
        // on this GET-order response since it's the same resource shape.
        const captureId = orderData.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        const activated = await activateCampaign(env, id, captureId);
        results.push({ campaign_id: id, status: activated ? "recovered_and_activated" : "activation_failed" });
        if (!activated) {
          await logError(env, "reconcile_activation_failed", `campaign ${id}, order ${campaign.paypal_order_id} already COMPLETED on PayPal's side`, "");
        } else if (!captureId) {
          await logError(env, "reconcile_no_capture_id", `campaign ${id}, order ${campaign.paypal_order_id} recovered as COMPLETED but no capture id found in the order response`, JSON.stringify(orderData));
        }
      } else {
        // CREATED / PAYER_ACTION_REQUIRED -- advertiser genuinely
        // hasn't paid yet, nothing to recover, leave it alone.
        results.push({ campaign_id: id, status: "still_waiting_on_advertiser", detail: orderData.status });
      }
    } catch (e) {
      await logError(env, "reconcile_check_failed", `campaign ${id}, order ${campaign.paypal_order_id}`, e.message);
    }
  }

  return { ok: true, scanned, results };
}

/** Public status lookup for one campaign, keyed by its own unguessable
 * UUID -- same access pattern as the developer claim page. No admin
 * token needed; only safe-to-share fields are returned. */
async function handleCampaignStatus(env, campaignId) {
  const raw = await env.CAMPAIGNS.get(`campaign:${campaignId}`);
  if (!raw) return json({ error: "not found" }, 404);
  const c = JSON.parse(raw);
  return json({
    id: c.id,
    line: c.line,
    url: c.url,
    company: c.company,
    price_usd: c.price_usd,
    impressions_total: c.impressions_total,
    impressions_delivered: c.impressions_delivered,
    daily_impressions: c.daily_impressions || {},
    status: c.status,
    created_at: c.created_at,
    activated_at: c.activated_at,
  });
}

async function handleListCampaigns(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const indexRaw = await env.CAMPAIGNS.get("index");
  const ids = indexRaw ? JSON.parse(indexRaw) : [];
  const campaigns = [];
  for (const id of ids) {
    const raw = await env.CAMPAIGNS.get(`campaign:${id}`);
    if (raw) campaigns.push(JSON.parse(raw));
  }
  campaigns.sort((a, b) => b.created_at - a.created_at);
  return json({ campaigns });
}

/** Durable replacement for babysitting `wrangler tail` -- shows the last
 * 200 real failures from every money-moving path, whenever you check,
 * not just while a 30-minute tail session happens to be open. */
async function handleListErrors(request, env) {
  if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const indexRaw = await env.ERRORS.get("index");
  const ids = indexRaw ? JSON.parse(indexRaw) : [];
  const errors = [];
  for (const id of ids.slice(0, 100)) {
    const raw = await env.ERRORS.get(`error:${id}`);
    if (raw) errors.push(JSON.parse(raw));
  }
  return json({ count: errors.length, errors });
}

/** logError() is also used as a general visibility channel for routine,
 * expected events (a heartbeat firing successfully, a jackpot month
 * skipped for lack of a pool) -- genuinely useful to see in /admin/errors,
 * but not evidence anything is actually wrong. Found live: /health
 * reported ok:false every single day purely because the Heartbeat cron
 * (fires every 20 min, entirely by design) logs its own success through
 * this same channel, making the health check permanently red under
 * normal operation -- useless for the exact external-monitor use case
 * it exists for. Excluded here, not from logging itself. */
const INFO_ONLY_LOG_CATEGORIES = new Set(["heartbeat_fired", "jackpot_skipped", "campaign_index_healed"]);

/** Public, no-auth health check -- returns real recent error counts so an
 * external uptime monitor (UptimeRobot, Better Uptime, etc.) can page you
 * if this starts failing, instead of relying on someone noticing by hand. */
async function handleHealth(env) {
  const indexRaw = await env.ERRORS.get("index");
  const ids = indexRaw ? JSON.parse(indexRaw) : [];
  const dayAgo = Date.now() / 1000 - 86400;
  let recentCount = 0;
  let lastError = null;
  for (const id of ids.slice(0, 50)) {
    const raw = await env.ERRORS.get(`error:${id}`);
    if (!raw) continue;
    const e = JSON.parse(raw);
    if (INFO_ONLY_LOG_CATEGORIES.has(e.category)) continue;
    if (!lastError) lastError = { category: e.category, at: e.at };
    if (e.at >= dayAgo) recentCount++;
  }
  return json({ ok: recentCount === 0, errors_last_24h: recentCount, last_error: lastError });
}

/** This used to do a full KV list()+get() scan on every single call --
 * fine for one person testing, genuinely unsustainable once real
 * visitors are polling this every 8 seconds each (that's exactly what
 * burned through Cloudflare's free-tier daily KV list() quota during
 * testing earlier this session -- error was real, not hypothetical).
 *
 * The 30s Cache API entry alone didn't actually fix it: caches.default
 * is per-edge-colo, not global, so visitors landing on different
 * Cloudflare PoPs each get their own cache miss and independently
 * trigger a fresh scan -- confirmed live, still flooding /admin/errors
 * with "KV list() limit exceeded" well after that fix shipped. Worse,
 * once the quota was actually exhausted for the day there was no
 * fallback: every request just re-threw and got logged, all day, with
 * nothing served to real visitors.
 *
 * Fixed two ways: cache TTL bumped from 30s to 5 minutes (this is a
 * vanity/ambient stats ticker, not billing-critical -- it doesn't need
 * near-real-time freshness, and a longer TTL directly cuts list() call
 * volume), and a durable last-known-good snapshot kept in a single KV
 * key (one cheap get/put, not a list()) that gets served -- marked
 * stale -- if the live scan throws for any reason, instead of a hard
 * 500 with nothing for the visitor to see. */
const NETWORK_STATS_SNAPSHOT_KEY = "cache:network-stats-snapshot";

async function handleNetworkStats(env, request) {
  const cacheKey = new Request(new URL("/network-stats", request.url).toString(), request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let stats;
  try {
    let cursor;
    let installs = 0;
    let total = 0;
    let sponsor = 0;
    do {
      const page = await env.INSTALLS.list({ prefix: "install:", cursor });
      for (const key of page.keys) {
        const raw = await env.INSTALLS.get(key.name);
        if (!raw) continue;
        const state = JSON.parse(raw);
        installs += 1;
        total += state.total_calls;
        sponsor += state.sponsor_calls;
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    stats = {
      installs,
      total_calls: total,
      sponsor_calls: sponsor,
      sponsor_ratio: total ? sponsor / total : 0,
      stale: false,
    };
    await env.INSTALLS.put(NETWORK_STATS_SNAPSHOT_KEY, JSON.stringify(stats));
  } catch (e) {
    await logError(env, "network_stats_scan_failed", "falling back to last known good snapshot", e.stack || e.message);
    const raw = await env.INSTALLS.get(NETWORK_STATS_SNAPSHOT_KEY);
    stats = raw
      ? { ...JSON.parse(raw), stale: true }
      : { installs: 0, total_calls: 0, sponsor_calls: 0, sponsor_ratio: 0, stale: true };
  }

  const res = json(stats);
  res.headers.set("Cache-Control", "public, max-age=300");
  await cache.put(cacheKey, res.clone());
  return res;
}

export default {
  /** Top-level safety net -- any uncaught exception anywhere in routing
   * (like the real KV list() daily-quota error found while testing)
   * used to surface as Cloudflare's opaque "error code: 1101" with
   * nothing logged. Now it's caught, logged durably, and returned as a
   * real JSON error instead. */
  async fetch(request, env) {
    try {
      return await this._route(request, env);
    } catch (e) {
      await logError(env, "unhandled_exception", `${request.method} ${new URL(request.url).pathname}`, e.stack || e.message);
      return json({ error: "internal error", detail: e.message }, 500);
    }
  },

  async _route(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/line") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing ?id=" }, 400);
      if (!isValidId(id)) return json({ error: "invalid id" }, 400);

      const rateLimit = await checkLineRateLimit(env, id);
      if (!rateLimit.ok) {
        return json({ error: "too many requests -- slow down" }, 429);
      }

      const eventName = url.searchParams.get("event");
      // 0 is a real, meaningful value here (a session's very first call has
      // genuinely spent $0 and 0 tokens) -- `|| null` would wrongly treat
      // that as "missing", so check finiteness explicitly instead.
      const parsedCost = parseFloat(url.searchParams.get("cost"));
      const parsedTokens = parseInt(url.searchParams.get("tok"), 10);
      const sessionEvidence = {
        sessionId: url.searchParams.get("sid") || "",
        cost: Number.isFinite(parsedCost) ? parsedCost : null,
        tokens: Number.isFinite(parsedTokens) ? parsedTokens : null,
        cwdHash: url.searchParams.get("cwd") || "",
      };
      return handleLine(env, id, eventName, sessionEvidence);
    }

    if (request.method === "GET" && url.pathname === "/earnings") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing ?id=" }, 400);
      if (!isValidId(id)) return json({ error: "invalid id" }, 400);
      return handleEarnings(env, id);
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/badge") {
      // HEAD support matters here specifically -- unlike every other GET
      // endpoint in this file, an embedded <img> badge can plausibly get
      // probed by link checkers, GitHub's own asset validation, or a
      // caching proxy issuing HEAD before GET. Found this live: `curl -I`
      // 404'd because the route only ever matched GET, falling through to
      // the static-asset catch-all. Real browsers loading an <img> tag
      // always issue GET, so this never broke the actual feature -- but
      // it's real, worth fixing rather than leaving as "works for the
      // only case that matters right now."
      return handleBadge(env, request);
    }

    if (request.method === "GET" && url.pathname === "/demo-line") {
      return handleDemoLine(env);
    }

    if (request.method === "POST" && url.pathname === "/advertiser-lead") {
      return handleAdvertiserLead(request, env);
    }

    if (request.method === "POST" && url.pathname === "/verify-advertiser") {
      return handleVerifyAdvertiser(request, env);
    }

    if (request.method === "GET" && url.pathname === "/campaign-status") {
      const cid = url.searchParams.get("id");
      if (!cid) return json({ error: "missing ?id=" }, 400);
      if (!isValidId(cid)) return json({ error: "invalid id" }, 400);
      return handleCampaignStatus(env, cid);
    }

    if (request.method === "GET" && url.pathname === "/network-stats") {
      return handleNetworkStats(env, request);
    }

    // Public and unauthenticated on purpose -- the entire pitch of the
    // jackpot is that it's independently verifiable, not "trust us."
    if (request.method === "GET" && url.pathname === "/jackpot-history") {
      return handleJackpotHistory(env);
    }

    if (request.method === "POST" && url.pathname === "/register-payout") {
      return handleRegisterPayout(request, env);
    }

    if (request.method === "POST" && url.pathname === "/set-name") {
      return handleSetName(request, env);
    }

    if (request.method === "POST" && url.pathname === "/paypal/create-order") {
      return handleCreatePayPalOrder(request, env);
    }

    if (request.method === "POST" && url.pathname === "/paypal/capture-order") {
      return handleCapturePayPalOrder(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/activate-campaign") {
      return handleActivateCampaign(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/refund-campaign") {
      return handleRefundCampaign(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/suspend-campaign") {
      return handleSuspendCampaign(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/resume-campaign") {
      return handleResumeCampaign(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/delete-install") {
      return handleDeleteInstall(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/delete-campaign") {
      return handleDeleteCampaign(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin/campaigns") {
      return handleListCampaigns(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/run-payouts") {
      if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
      const result = await runPayouts(env);
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/admin/run-jackpot") {
      if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
      const result = await runJackpotDraw(env);
      return json(result);
    }

    if (request.method === "POST" && url.pathname === "/admin/reconcile-orders") {
      if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
      const result = await reconcilePendingOrders(env);
      return json(result);
    }

    if (request.method === "GET" && url.pathname === "/admin/errors") {
      return handleListErrors(request, env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }

    // Anything else falls through to the static site (install.html,
    // advertiser.html, claim.html) served from the same Worker via assets.
    // Root and /claim have no matching filename -- rewrite explicitly.
    // HEAD is included alongside GET: link-checkers, crawlers, and some
    // social-card unfurlers probe with HEAD before ever issuing a GET, and
    // env.ASSETS.fetch handles HEAD correctly (headers only, no body) on
    // its own -- this was previously GET-only, so every HEAD request to
    // every page on the site returned a bare 404.
    if (request.method === "GET" || request.method === "HEAD") {
      if (url.pathname === "/") {
        return env.ASSETS.fetch(new Request(new URL("/install.html", url), request));
      }
      if (url.pathname === "/claim") {
        return env.ASSETS.fetch(new Request(new URL("/claim.html", url), request));
      }
      if (url.pathname === "/dashboard") {
        return env.ASSETS.fetch(new Request(new URL("/dashboard.html", url), request));
      }
      // Short, typeable aliases for the real install scripts -- the whole
      // point is a command someone can read once and retype without
      // copy-paste, same spirit as `curl sh.rustup.rs | sh`. Same file,
      // same source of truth, just a shorter door to it.
      if (url.pathname === "/go") {
        return env.ASSETS.fetch(new Request(new URL("/install.sh", url), request));
      }
      if (url.pathname === "/go.ps1") {
        return env.ASSETS.fetch(new Request(new URL("/install.ps1", url), request));
      }
      if (url.pathname === "/go-copilot") {
        return env.ASSETS.fetch(new Request(new URL("/install_copilot.sh", url), request));
      }
      return env.ASSETS.fetch(request);
    }

    return json({ error: "not found" }, 404);
  },

  /** Real, unattended payout automation -- Cloudflare fires this on the
   * cron schedule in wrangler.toml regardless of whether anyone has this
   * site open. No chat session, no manual trigger required. */
  async scheduled(event, env, ctx) {
    // Two schedules share this one handler -- daily (payouts, the slow
    // side) and every 20 min (reconciliation, the side where money can
    // be visibly stuck for a real advertiser and every extra hour
    // matters more).
    if (event.cron === "11 6 * * *") {
      ctx.waitUntil(
        runPayouts(env).catch((e) => logError(env, "scheduled_payout_crash", "the daily cron itself threw", e.message))
      );
      // Piggybacks on the same daily trigger rather than a separate cron
      // schedule -- only actually attempts a draw on the 1st, and
      // runJackpotDraw's own jackpot:last_draw_month guard makes it safe
      // even if this somehow fired more than once on that day.
      if (new Date().getUTCDate() === 1) {
        ctx.waitUntil(
          runJackpotDraw(env).catch((e) => logError(env, "scheduled_jackpot_crash", "the monthly jackpot draw itself threw", e.message))
        );
      }
    }
    ctx.waitUntil(
      reconcilePendingOrders(env).catch((e) => logError(env, "scheduled_reconcile_crash", "the reconciliation sweep itself threw", e.message))
    );
    ctx.waitUntil(
      maybeFireHeartbeat(env).catch((e) => logError(env, "scheduled_heartbeat_crash", "the heartbeat check itself threw", e.message))
    );
  },
};
