#!/usr/bin/env node
// The `npx trymeanwhile` entry point -- one cross-platform script that
// detects which tool(s) are actually installed and wires them up. The
// status line it wires in (statusline.js) runs on Node too, not Python:
// Node is already guaranteed present since npx can't invoke this script
// without it, so there's no second runtime to find, verify, or fail on.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, exec } = require("child_process");

const SERVER = "https://trymeanwhile.online";
const INSTALL_DIR = path.join(os.homedir(), ".deadtime-client");
const STATE_DIR = path.join(os.homedir(), ".deadtime");

const VERBOSE = process.argv.includes("--verbose");

function log(msg) {
  console.log(`meanwhile: ${msg}`);
}

// Wiring detail nobody needs to see on a normal run -- which settings.json,
// which script path, that kind of thing. Real information, just not the
// first-run experience: it used to be seven identical-looking lines with no
// hierarchy, so the one line that actually mattered (restart your tool)
// read the same as housekeeping noise. Still here for anyone debugging why
// it didn't wire correctly -- just behind --verbose instead of always on.
function vlog(msg) {
  if (VERBOSE) log(msg);
}

function commandExists(cmd) {
  return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
}

function openUrl(url) {
  const cmd =
    process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function downloadTo(remoteName, localPath) {
  const res = await fetch(`${SERVER}/${remoteName}`);
  if (!res.ok) throw new Error(`couldn't download ${remoteName} (${res.status})`);
  fs.writeFileSync(localPath, await res.text());
}

function wireSettings(settingsPath, runtime, scriptPath) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8") || "{}") : {};
  settings.statusLine = { type: "command", command: `"${runtime}" "${scriptPath}"` };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  vlog(`wired into ${settingsPath}`);
}

// Wraps any long-running shell command (npm install, docker build, terraform
// apply, ...) and shows the same disclosed line the Claude Code/Copilot
// status lines show -- reusing the exact same /line endpoint and billing
// mechanism, just from a different trigger than an editor hook. The server
// only bills a line if it stayed on screen >= BILLABLE_THRESHOLD (10s), so
// this polls every 15s -- fast enough to feel alive, slow enough that real
// polls actually bill instead of always resetting the timer on each other.
async function wrapCommand(args) {
  const cmdArgs = args[0] === "--" ? args.slice(1) : args;
  if (cmdArgs.length === 0) {
    log("usage: npx trymeanwhile wrap -- <command> [args...]");
    log("example: npx trymeanwhile wrap -- npm install");
    process.exit(1);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const idPath = path.join(STATE_DIR, "install_id");
  if (!fs.existsSync(idPath)) {
    fs.writeFileSync(idPath, crypto.randomUUID(), { mode: 0o600 });
  }
  const installId = fs.readFileSync(idPath, "utf8").trim();

  const { spawn } = require("child_process");
  const child = spawn(cmdArgs[0], cmdArgs.slice(1), { stdio: "inherit", shell: process.platform === "win32" });

  let stopped = false;
  (async function pollLoop() {
    while (!stopped) {
      try {
        const res = await fetch(`${SERVER}/line?id=${installId}&event=cli_wrap`);
        if (res.ok) {
          const data = await res.json();
          process.stderr.write(`\nmeanwhile: ${data.line}\n`);
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 15000));
    }
  })();

  child.on("exit", (code) => {
    stopped = true;
    process.exit(code === null ? 1 : code);
  });
}

// `npx trymeanwhile claim` -- the whole point of this is that nobody
// should ever need to remember (or read) a raw node/path/--claim
// incantation just to check what they've earned. Same install ID file,
// same /earnings endpoint statusline.js already hits, just reachable
// through the one command name people already typed once.
async function claimCommand() {
  const idPath = path.join(STATE_DIR, "install_id");
  if (!fs.existsSync(idPath)) {
    log("nothing to claim yet -- you haven't installed. run `npx trymeanwhile` first.");
    process.exit(1);
  }
  const installId = fs.readFileSync(idPath, "utf8").trim();
  const claimUrl = `${SERVER}/claim?id=${installId}`;

  console.log("meanwhile -- your account");
  console.log(`  ID:      ${installId}`);
  try {
    const res = await fetch(`${SERVER}/earnings?id=${installId}`);
    if (res.ok) {
      const earnings = await res.json();
      console.log(`  earned:  $${Number(earnings.user_earnings).toFixed(2)}`);
      console.log(`  shown:   ${earnings.total_calls} lines (${earnings.sponsor_calls} sponsored)`);
    } else {
      console.log("  earned:  (couldn't reach server -- check your connection)");
    }
  } catch {
    console.log("  earned:  (couldn't reach server -- check your connection)");
  }
  console.log();
  console.log(`  register a payout email: ${claimUrl}`);
}

async function main() {
  if (process.argv[2] === "wrap") {
    await wrapCommand(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "claim") {
    await claimCommand();
    return;
  }

  vlog(`installing to ${INSTALL_DIR}`);
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });

  // Real install ID, generated on the device the moment an install
  // actually happens -- not guessed ahead of time by the website. Only
  // if one doesn't already exist, so re-running this never clobbers an
  // existing install's history with a fresh random ID. Shared across
  // both integrations below, same as the shell installers.
  const idPath = path.join(STATE_DIR, "install_id");
  if (!fs.existsSync(idPath)) {
    fs.writeFileSync(idPath, crypto.randomUUID(), { mode: 0o600 });
  }
  const installId = fs.readFileSync(idPath, "utf8").trim();

  // Node, not Python: this script is already running under Node (it can't
  // not be -- npx just invoked it), so there is no second runtime to find
  // or verify. process.execPath is the absolute path to the exact node
  // binary running right now, more robust than trusting a bare `node` on
  // PATH (some distros only ship `nodejs`). This used to hard-require
  // python3/python/py on top of Node and fail the whole install for
  // anyone without it -- a real dead stop, not a cosmetic gap.
  const node = process.execPath;

  // Wire whichever tool(s) are actually on this machine, so the same
  // command works everywhere instead of a different one per tool. Claude
  // Code is always wired -- it's the primary target this package was
  // built for -- and Copilot CLI is wired too if it's detected on PATH.
  const wireCopilot = commandExists("copilot");

  const claudeScript = path.join(INSTALL_DIR, "statusline.js");
  await downloadTo("statusline.js", claudeScript);
  wireSettings(path.join(os.homedir(), ".claude", "settings.json"), node, claudeScript);

  if (wireCopilot) {
    const copilotScript = path.join(INSTALL_DIR, "copilot_statusline.js");
    await downloadTo("copilot_statusline.js", copilotScript);
    wireSettings(path.join(os.homedir(), ".copilot", "settings.json"), node, copilotScript);
    vlog("Copilot CLI detected -- wired that too, same install ID, earnings share one balance.");
  }

  // Prove the connection actually works right now, before asking anyone
  // to trust a restart they can't yet see the result of. A skeptical
  // first-time installer shouldn't have to take "it'll work after you
  // restart" on faith -- this is the exact same /line call the real
  // client makes, just fired once, synchronously, during install.
  // Non-fatal if it fails (slow network, offline install) -- the real
  // client will pick it up fine once the tool actually restarts.
  let sampleLine = null;
  try {
    const params = new URLSearchParams({ id: installId, event: "install_check", sid: "", cost: "", tok: "", cwd: "" });
    const res = await fetch(`${SERVER}/line?${params}`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (data.line) sampleLine = data.line;
    }
  } catch {}

  // The one-time summary a real person actually reads. This used to be
  // seven identically-styled lines -- the one thing that actually matters
  // (restart your tool) read no differently than housekeeping. Blank
  // lines and indentation do the hierarchy work no --verbose flag can.
  console.log("meanwhile: installed. congratulations, you now get paid to wait.");
  console.log();
  if (sampleLine) {
    console.log(`  just tested the connection -- here's a real line: "${sampleLine}"`);
    console.log();
  }
  console.log("  restart Claude Code to see it live");
  console.log("  (the one step between you and money -- yes, actually do it)");
  console.log();
  if (wireCopilot) {
    console.log("Copilot CLI's in on this too, if it's here. Same balance either way.");
    console.log();
  }
  console.log("Check what you've earned:  npx trymeanwhile claim");

  // Open the browser straight to the claim page -- same pattern as
  // `gh auth login` / `vercel login` / `wrangler login`. This is the only
  // honest way for the site to know an install actually happened: it
  // fires because this really did just write a real install ID, not
  // because someone merely copied a command.
  const claimUrl = `${SERVER}/claim.html?id=${installId}`;
  openUrl(claimUrl);
  console.log(`(if a browser tab didn't open: ${claimUrl})`);
}

main().catch((err) => {
  console.error(`meanwhile: install failed -- ${err.message}`);
  process.exit(1);
});
