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

const TIPS = [
  "Tip: /rewind lets you jump back to an earlier point in this session",
  "Tip: Shift+Tab cycles permission modes without leaving the prompt",
  "Tip: ask for a plan before a big change -- cheaper to fix than code",
  "Tip: /compact early avoids losing context on long sessions",
  "Tip: paste a screenshot directly, no need to save it first",
  "Tip: name files before you ask for them, saves a round trip",
  "Tip: /clear between unrelated tasks keeps context focused",
  "Fact: most bugs hide in the code you were most confident about",
];

const HOUSE_SPONSOR = "(sponsored) deadtime -- get paid while your agent thinks -> deadtime.dev";
const IMPRESSIONS_PER_BLOCK = 1000;
const USD_PER_BLOCK = 2.0;
const PAYPAL_API = "https://api-m.paypal.com"; // LIVE -- real money, no sandbox fallback configured

const FILL_CEILING = 0.6;
const BILLABLE_THRESHOLD = 10;
const CPM = 2.0;
const USER_SHARE = 0.5;

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
  };
}

/** No signup exists anywhere in this system -- an install_id is just a
 * self-generated UUID, and /line has no way to verify a call actually
 * came from a real Claude Code session versus a script hitting the
 * endpoint every ~10 seconds forever. Worked the real numbers: a bot
 * doing that 24/7 could fully drain any real advertiser's entire paid
 * campaign in under 10 hours of 100% fake impressions no human ever
 * saw -- real fraud against a paying customer, not just fake-earnings
 * farming. A genuine heavy human user, even 10 real hours of active
 * Claude Code use with real prompts, doesn't come close to this. This
 * doesn't stop a patient bot staying under the cap, but it puts a hard
 * ceiling on the fast, crude version of the attack, at a level no real
 * user will ever hit. */
const DAILY_BILLABLE_CAP = 2000;
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function sponsorRatio(state) {
  if (state.total_calls === 0) return 0;
  return state.sponsor_calls / state.total_calls;
}

function formatCampaignLine(campaign) {
  return `(sponsored) ${campaign.line} -> ${campaign.url}`;
}

/** Active campaigns are the real, paid-and-activated ad pool -- falls back
 * to the house ad only when nothing real is running, so the slot is never
 * fully empty during early testing. */
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

async function pickLine(env, state) {
  const ratio = sponsorRatio(state);
  const eligible = ratio < FILL_CEILING && Math.random() < FILL_CEILING;
  if (!eligible) {
    return { kind: "tip", line: TIPS[Math.floor(Math.random() * TIPS.length)] };
  }

  const active = await getActiveCampaigns(env);
  if (active.length > 0) {
    const campaign = active[Math.floor(Math.random() * active.length)];
    return { kind: "sponsor", line: formatCampaignLine(campaign), campaign_id: campaign.id };
  }
  // no real paid campaigns yet -- house ad keeps the mechanism testable
  return { kind: "sponsor", line: HOUSE_SPONSOR, campaign_id: null };
}

/** Called when a sponsor line is actually billed -- attributes the real
 * impression to its campaign and exhausts it once the paid block runs out. */
/** Real, known limitation, not hidden: this is a read-increment-write on
 * a single shared key, and Workers KV has no atomic increment or
 * compare-and-swap. Two concurrent deliveries for the same popular
 * campaign (entirely realistic once there's real traffic -- this is
 * the ONE key every delivery of that campaign touches, from any user,
 * anywhere) can race, and one write can clobber the other's increment.
 * Retrying with a fresh re-read each attempt meaningfully narrows the
 * collision window, but doesn't close it -- proven directly tonight
 * with the campaign-index bug that an immediate read-back can't be
 * trusted either, since KV itself is eventually consistent. A fully
 * atomic fix needs Cloudflare Durable Objects; this is the honest
 * best-effort mitigation on the current KV-only architecture. */
async function deliverImpression(env, campaignId) {
  if (!campaignId) return;
  const key = `campaign:${campaignId}`;
  let done = false;
  for (let attempt = 0; attempt < 3 && !done; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 60 * attempt));
    const raw = await env.CAMPAIGNS.get(key);
    if (!raw) return;
    const campaign = JSON.parse(raw);
    const expected = campaign.impressions_delivered + 1;
    campaign.impressions_delivered = expected;
    if (campaign.impressions_delivered >= campaign.impressions_total) {
      campaign.status = "exhausted";
    }
    await env.CAMPAIGNS.put(key, JSON.stringify(campaign));

    // Best-effort check, not proof -- KV's own eventual consistency
    // means this can still be wrong. What it reliably prevents is the
    // real mistake above: blindly looping N times would have added N
    // to the counter for one real impression. This only re-attempts
    // (fresh read, +1 relative to whatever's actually there now) if
    // the write doesn't look like it landed.
    const verifyRaw = await env.CAMPAIGNS.get(key);
    const verifyCampaign = verifyRaw ? JSON.parse(verifyRaw) : null;
    done = !!verifyCampaign && verifyCampaign.impressions_delivered >= expected;
  }
}

async function handleLine(env, installId, eventName) {
  const key = `install:${installId}`;
  const raw = await env.INSTALLS.get(key);
  const state = raw ? JSON.parse(raw) : defaultState();
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
  }

  if (state.current_line !== null && !state.billed_current) {
    const visibleFor = now - state.line_started;
    if (visibleFor >= BILLABLE_THRESHOLD) {
      if (state.billed_today < DAILY_BILLABLE_CAP) {
        state.total_calls += 1;
        state.billed_today += 1;
        if (state.current_kind === "sponsor") {
          state.sponsor_calls += 1;
          await deliverImpression(env, state.current_campaign_id);
        }
      } else if (state.billed_today === DAILY_BILLABLE_CAP) {
        // Log once, not on every call past the cap -- a real signal
        // worth a human looking at, not log spam.
        state.billed_today += 1;
        await logError(env, "daily_billable_cap_hit", `install ${installId} hit the ${DAILY_BILLABLE_CAP}/day billable cap`, "either a genuinely extreme real user, or automated polling -- worth a look");
      }
    }
  }

  // Every real invocation picks a fresh line -- no artificial hold timer.
  const picked = await pickLine(env, state);
  state.current_kind = picked.kind;
  state.current_line = picked.line;
  state.current_campaign_id = picked.campaign_id || null;
  state.line_started = now;
  state.billed_current = false;
  state.last_event = eventName || "unknown";

  await env.INSTALLS.put(key, JSON.stringify(state));
  return json({ line: state.current_line, kind: state.current_kind });
}

async function handleEarnings(env, installId) {
  const raw = await env.INSTALLS.get(`install:${installId}`);
  const state = raw ? JSON.parse(raw) : defaultState();
  const revenue = state.sponsor_calls * (CPM / 1000);
  return json({
    total_calls: state.total_calls,
    sponsor_calls: state.sponsor_calls,
    sponsor_ratio: sponsorRatio(state),
    gross_revenue: revenue,
    user_earnings: revenue * USER_SHARE,
    payout_email: state.payout_email || null,
  });
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
async function handleRegisterPayout(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { id, email, current_email } = data;
  if (!id || !email) return json({ error: "missing id or email" }, 400);
  if (!isValidId(id)) return json({ error: "invalid id" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "invalid email" }, 400);

  const key = `install:${id}`;
  const raw = await env.INSTALLS.get(key);
  const state = raw ? JSON.parse(raw) : defaultState();

  if (state.payout_email && state.payout_email.toLowerCase() !== email.toLowerCase()) {
    if (!current_email || current_email.toLowerCase() !== state.payout_email.toLowerCase()) {
      await logError(env, "payout_email_change_blocked", `install ${id} tried to change payout email without confirming the current one`, `existing: ${state.payout_email}, attempted: ${email}`);
      return json({ error: "to change an already-registered payout email, you must also provide the current one" }, 403);
    }
  }

  state.payout_email = email;
  await env.INSTALLS.put(key, JSON.stringify(state));

  const revenue = state.sponsor_calls * (CPM / 1000);
  const earnings = revenue * USER_SHARE;
  return json({
    ok: true,
    email,
    current_earnings: earnings,
    payout_threshold: PAYOUT_THRESHOLD_USD,
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

/** The real payout sweep: scans every install, and for anyone whose
 * unpaid balance has crossed the threshold, actually sends the money.
 * paid_out_usd tracks what's already been sent so nobody gets double-paid
 * on the next run. Called both by the manual admin endpoint and by the
 * scheduled() cron trigger -- same one real algorithm, two triggers. */
async function runPayouts(env) {
  const results = [];
  let cursor;
  do {
    const page = await env.INSTALLS.list({ prefix: "install:", cursor });
    for (const key of page.keys) {
      const raw = await env.INSTALLS.get(key.name);
      if (!raw) continue;
      const state = JSON.parse(raw);
      if (!state.payout_email) continue;

      const revenue = state.sponsor_calls * (CPM / 1000);
      const earnings = revenue * USER_SHARE;
      const unpaid = earnings - (state.paid_out_usd || 0);
      if (unpaid < PAYOUT_THRESHOLD_USD) continue;

      const installId = key.name.replace(/^install:/, "");
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
async function checkLeadRateLimit(env, ip) {
  const key = `ratelimit:lead:${ip}`;
  const raw = await env.LEADS.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= LEAD_RATE_LIMIT) return false;
  await env.LEADS.put(key, String(count + 1), { expirationTtl: LEAD_RATE_WINDOW_SECONDS });
  return true;
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
  const blocks = Math.max(1, Math.min(1000, parseInt(data.blocks, 10) || 1));

  const id = crypto.randomUUID();
  const campaign = {
    id,
    line: String(data.line).slice(0, 60),
    url: String(data.url).slice(0, 300),
    company: String(data.company).slice(0, 100),
    email: String(data.email).slice(0, 200),
    blocks,
    price_usd: blocks * USD_PER_BLOCK,
    impressions_total: blocks * IMPRESSIONS_PER_BLOCK,
    impressions_delivered: 0,
    status: "pending_payment",
    created_at: Date.now() / 1000,
    activated_at: null,
  };

  await env.CAMPAIGNS.put(`campaign:${id}`, JSON.stringify(campaign));

  // "index" is a single shared KV key, read-modified-and-written back --
  // if two advertisers submit within the same moment, both can read the
  // same old array and one write clobbers the other, silently dropping
  // a real, paid campaign out of every list that matters (delivery,
  // admin view, reconciliation). campaign:${id} itself is always safe
  // (its own key), but without being in "index" it's invisible. Retry a
  // few times with a fresh re-read each attempt, and verify the write
  // actually landed -- collapses the realistic collision window to
  // near-zero without needing real compare-and-swap (KV doesn't have
  // one). The 20-min reconciliation sweep self-heals anything that
  // still slips through.
  let indexed = false;
  for (let attempt = 0; attempt < 4 && !indexed; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150 * attempt));
    const indexRaw = await env.CAMPAIGNS.get("index");
    const index = indexRaw ? JSON.parse(indexRaw) : [];
    if (!index.includes(id)) index.push(id);
    await env.CAMPAIGNS.put("index", JSON.stringify(index));
    const verifyRaw = await env.CAMPAIGNS.get("index");
    const verifyIndex = verifyRaw ? JSON.parse(verifyRaw) : [];
    indexed = verifyIndex.includes(id);
  }
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
  return json({ ok: true, deleted: campaign_id });
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
  let ids = indexRaw ? JSON.parse(indexRaw) : [];
  const knownIds = new Set(ids);
  let healedAny = false;
  let cursor;
  do {
    const page = await env.CAMPAIGNS.list({ prefix: "campaign:", cursor });
    for (const key of page.keys) {
      const realId = key.name.replace(/^campaign:/, "");
      if (!knownIds.has(realId)) {
        knownIds.add(realId);
        ids.push(realId);
        healedAny = true;
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  if (healedAny) {
    await env.CAMPAIGNS.put("index", JSON.stringify(ids));
    await logError(env, "campaign_index_healed", `reconciliation found campaign(s) missing from the index and added them back`, JSON.stringify(ids));
  }

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
        // step never ran (e.g. the Worker died mid-request).
        const activated = await activateCampaign(env, id);
        results.push({ campaign_id: id, status: activated ? "recovered_and_activated" : "activation_failed" });
        if (!activated) {
          await logError(env, "reconcile_activation_failed", `campaign ${id}, order ${campaign.paypal_order_id} already COMPLETED on PayPal's side`, "");
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
    blocks: c.blocks,
    price_usd: c.price_usd,
    impressions_total: c.impressions_total,
    impressions_delivered: c.impressions_delivered,
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
    if (!lastError) lastError = { category: e.category, at: e.at };
    if (e.at >= dayAgo) recentCount++;
  }
  return json({ ok: recentCount === 0, errors_last_24h: recentCount, last_error: lastError });
}

/** This used to do a full KV list()+get() scan on every single call --
 * fine for one person testing, genuinely unsustainable once real
 * visitors are polling this every 8 seconds each (that's exactly what
 * burned through Cloudflare's free-tier daily KV list() quota during
 * testing tonight -- error was real, not hypothetical). Cached for 30s
 * via the Cache API so a burst of visitors shares one scan instead of
 * one each. */
async function handleNetworkStats(env, request) {
  const cacheKey = new Request(new URL("/network-stats", request.url).toString(), request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

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

  const res = json({
    installs,
    total_calls: total,
    sponsor_calls: sponsor,
    sponsor_ratio: total ? sponsor / total : 0,
  });
  res.headers.set("Cache-Control", "public, max-age=30");
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
      const eventName = url.searchParams.get("event");
      return handleLine(env, id, eventName);
    }

    if (request.method === "GET" && url.pathname === "/earnings") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing ?id=" }, 400);
      if (!isValidId(id)) return json({ error: "invalid id" }, 400);
      return handleEarnings(env, id);
    }

    if (request.method === "POST" && url.pathname === "/advertiser-lead") {
      return handleAdvertiserLead(request, env);
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

    if (request.method === "POST" && url.pathname === "/register-payout") {
      return handleRegisterPayout(request, env);
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
    if (request.method === "GET") {
      if (url.pathname === "/") {
        return env.ASSETS.fetch(new Request(new URL("/install.html", url), request));
      }
      if (url.pathname === "/claim") {
        return env.ASSETS.fetch(new Request(new URL("/claim.html", url), request));
      }
      if (url.pathname === "/dashboard") {
        return env.ASSETS.fetch(new Request(new URL("/dashboard.html", url), request));
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
    }
    ctx.waitUntil(
      reconcilePendingOrders(env).catch((e) => logError(env, "scheduled_reconcile_crash", "the reconciliation sweep itself threw", e.message))
    );
  },
};
