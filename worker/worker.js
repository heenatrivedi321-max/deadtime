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

const FILL_CEILING = 0.40;
const BILLABLE_THRESHOLD = 10;
const CPM = 2.0;
const USER_SHARE = 0.5;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
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
  };
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
async function deliverImpression(env, campaignId) {
  if (!campaignId) return;
  const key = `campaign:${campaignId}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return;
  const campaign = JSON.parse(raw);
  campaign.impressions_delivered += 1;
  if (campaign.impressions_delivered >= campaign.impressions_total) {
    campaign.status = "exhausted";
  }
  await env.CAMPAIGNS.put(key, JSON.stringify(campaign));
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
  if (state.current_line !== null && !state.billed_current) {
    const visibleFor = now - state.line_started;
    if (visibleFor >= BILLABLE_THRESHOLD) {
      state.total_calls += 1;
      if (state.current_kind === "sponsor") {
        state.sponsor_calls += 1;
        await deliverImpression(env, state.current_campaign_id);
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
const PAYOUT_THRESHOLD_USD = 25;

async function handleRegisterPayout(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { id, email } = data;
  if (!id || !email) return json({ error: "missing id or email" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "invalid email" }, 400);

  const key = `install:${id}`;
  const raw = await env.INSTALLS.get(key);
  const state = raw ? JSON.parse(raw) : defaultState();
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

/** Sends one real PayPal payout to a developer's registered email. This
 * moves actual money out -- separate API from the advertiser-side
 * order/capture flow, which only ever moves money in. */
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
  return data;
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
        await sendPayPalPayout(env, installId, state.payout_email, unpaid);
        state.paid_out_usd = (state.paid_out_usd || 0) + unpaid;
        state.last_payout_at = Date.now() / 1000;
        await env.INSTALLS.put(key.name, JSON.stringify(state));
        results.push({ install_id: installId, email: state.payout_email, amount: unpaid, status: "sent" });
      } catch (e) {
        results.push({ install_id: installId, email: state.payout_email, amount: unpaid, status: "failed", error: e.message });
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
async function handleAdvertiserLead(request, env) {
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
  const indexRaw = await env.CAMPAIGNS.get("index");
  const index = indexRaw ? JSON.parse(indexRaw) : [];
  index.push(id);
  await env.CAMPAIGNS.put("index", JSON.stringify(index));

  return json({ ok: true, campaign_id: id, price_usd: campaign.price_usd });
}

function checkAdmin(request, env) {
  const token = request.headers.get("X-Admin-Token");
  return token && env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

/** Shared by both the manual admin endpoint and the automatic PayPal
 * capture handler -- this is the one real activation algorithm, called
 * from two different triggers. */
async function activateCampaign(env, campaignId) {
  const key = `campaign:${campaignId}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return null;
  const campaign = JSON.parse(raw);
  campaign.status = "active";
  campaign.activated_at = Date.now() / 1000;
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
  if (!orderRes.ok) return json({ error: order.message || "order creation failed" }, 502);

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
async function handleCapturePayPalOrder(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { order_id } = data;
  if (!order_id) return json({ error: "missing order_id" }, 400);

  let token;
  try {
    token = await getPayPalToken(env);
  } catch (e) {
    return json({ error: "paypal auth failed" }, 502);
  }

  const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${order_id}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const capture = await captureRes.json();
  if (!captureRes.ok || capture.status !== "COMPLETED") {
    return json({ error: "capture failed", detail: capture }, 502);
  }

  const campaignId = capture.purchase_units?.[0]?.reference_id;
  if (!campaignId) return json({ error: "no reference_id on captured order" }, 500);

  const activated = await activateCampaign(env, campaignId);
  if (!activated) return json({ error: "campaign not found for activation" }, 500);

  return json({ ok: true, campaign: activated });
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

async function handleNetworkStats(env) {
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

  return json({
    installs,
    total_calls: total,
    sponsor_calls: sponsor,
    sponsor_ratio: total ? sponsor / total : 0,
  });
}

export default {
  async fetch(request, env) {
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
      const eventName = url.searchParams.get("event");
      return handleLine(env, id, eventName);
    }

    if (request.method === "GET" && url.pathname === "/earnings") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing ?id=" }, 400);
      return handleEarnings(env, id);
    }

    if (request.method === "POST" && url.pathname === "/advertiser-lead") {
      return handleAdvertiserLead(request, env);
    }

    if (request.method === "GET" && url.pathname === "/campaign-status") {
      const cid = url.searchParams.get("id");
      if (!cid) return json({ error: "missing ?id=" }, 400);
      return handleCampaignStatus(env, cid);
    }

    if (request.method === "GET" && url.pathname === "/network-stats") {
      return handleNetworkStats(env);
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

    if (request.method === "GET" && url.pathname === "/admin/campaigns") {
      return handleListCampaigns(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/run-payouts") {
      if (!checkAdmin(request, env)) return json({ error: "unauthorized" }, 401);
      const result = await runPayouts(env);
      return json(result);
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
    ctx.waitUntil(runPayouts(env));
  },
};
