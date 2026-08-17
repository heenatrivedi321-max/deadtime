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

  const key = `campaign:${campaign_id}`;
  const raw = await env.CAMPAIGNS.get(key);
  if (!raw) return json({ error: "not found" }, 404);
  const campaign = JSON.parse(raw);
  campaign.status = "active";
  campaign.activated_at = Date.now() / 1000;
  await env.CAMPAIGNS.put(key, JSON.stringify(campaign));
  return json({ ok: true, campaign });
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

    if (request.method === "GET" && url.pathname === "/network-stats") {
      return handleNetworkStats(env);
    }

    if (request.method === "POST" && url.pathname === "/register-payout") {
      return handleRegisterPayout(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/activate-campaign") {
      return handleActivateCampaign(request, env);
    }

    if (request.method === "GET" && url.pathname === "/admin/campaigns") {
      return handleListCampaigns(request, env);
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
      return env.ASSETS.fetch(request);
    }

    return json({ error: "not found" }, 404);
  },
};
