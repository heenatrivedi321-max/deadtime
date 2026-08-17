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

const SPONSORS = [
  "(sponsored) deadtime -- get paid while your agent thinks -> deadtime.dev",
];

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
  };
}

function sponsorRatio(state) {
  if (state.total_calls === 0) return 0;
  return state.sponsor_calls / state.total_calls;
}

function pickLine(state) {
  const ratio = sponsorRatio(state);
  const showSponsor = SPONSORS.length && ratio < FILL_CEILING && Math.random() < FILL_CEILING;
  if (showSponsor) {
    return { kind: "sponsor", line: SPONSORS[Math.floor(Math.random() * SPONSORS.length)] };
  }
  return { kind: "tip", line: TIPS[Math.floor(Math.random() * TIPS.length)] };
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
      if (state.current_kind === "sponsor") state.sponsor_calls += 1;
    }
  }

  // Every real invocation picks a fresh line -- no artificial hold timer.
  const picked = pickLine(state);
  state.current_kind = picked.kind;
  state.current_line = picked.line;
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
  });
}

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
  data.ts = Date.now() / 1000;
  const key = `lead:${data.ts}:${crypto.randomUUID()}`;
  await env.LEADS.put(key, JSON.stringify(data));
  return json({ ok: true });
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

    // Anything else falls through to the static site (install.html,
    // advertiser.html) served from the same Worker via assets.
    // Root has no index.html -- rewrite it to install.html explicitly.
    if (request.method === "GET") {
      if (url.pathname === "/") {
        return env.ASSETS.fetch(new Request(new URL("/install.html", url), request));
      }
      return env.ASSETS.fetch(request);
    }

    return json({ error: "not found" }, 404);
  },
};
