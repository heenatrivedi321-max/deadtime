#!/usr/bin/env node
// Node reimplementation of install.sh/install.ps1 -- one script instead of
// two, since Node itself is already cross-platform. Behavior is kept in
// lockstep with those scripts (same install dir, same settings.json shape,
// same non-fatal certifi step) so all three installers produce an
// identical result regardless of which one someone happens to run.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, exec } = require("child_process");

const SERVER = "https://trymeanwhile.online";
const INSTALL_DIR = path.join(os.homedir(), ".deadtime-client");
const STATE_DIR = path.join(os.homedir(), ".deadtime");

function log(msg) {
  console.log(`meanwhile: ${msg}`);
}

function findPython() {
  for (const candidate of ["python3", "python", "py"]) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (result.status === 0) return candidate;
  }
  return null;
}

function openUrl(url) {
  const cmd =
    process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  log(`installing to ${INSTALL_DIR}`);
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });

  // Real install ID, generated on the device the moment an install
  // actually happens -- not guessed ahead of time by the website. Only
  // if one doesn't already exist, so re-running this never clobbers an
  // existing install's history with a fresh random ID.
  const idPath = path.join(STATE_DIR, "install_id");
  if (!fs.existsSync(idPath)) {
    fs.writeFileSync(idPath, crypto.randomUUID(), { mode: 0o600 });
  }
  const installId = fs.readFileSync(idPath, "utf8").trim();

  const res = await fetch(`${SERVER}/statusline.py`);
  if (!res.ok) {
    console.error(`meanwhile: couldn't download statusline.py (${res.status}) -- try again in a moment.`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(INSTALL_DIR, "statusline.py"), await res.text());

  const python = findPython();
  if (!python) {
    log("couldn't find Python on your PATH.");
    log("install it from https://python.org, then run `npx trymeanwhile` again.");
    process.exit(1);
  }

  // certifi is a nice-to-have, not a hard requirement -- statusline.py
  // falls back to the system's own certificate store if it's missing.
  // Never let a failed pip install here take down the rest of the setup.
  const hasCertifi = spawnSync(python, ["-c", "import certifi"], { stdio: "ignore" }).status === 0;
  if (!hasCertifi) {
    log("installing certifi (helps with HTTPS, not required)...");
    const pipAttempts = [
      ["-m", "pip", "install", "--quiet", "certifi"],
      ["-m", "pip", "install", "--quiet", "--user", "certifi"],
      ["-m", "pip", "install", "--quiet", "--break-system-packages", "certifi"],
    ];
    const installed = pipAttempts.some(
      (args) => spawnSync(python, args, { stdio: "ignore" }).status === 0
    );
    if (!installed) log("couldn't install certifi, continuing without it (statusline.py falls back automatically)");
  }

  const scriptPath = path.join(INSTALL_DIR, "statusline.py");
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8") || "{}") : {};
  settings.statusLine = { type: "command", command: `${python} "${scriptPath}"` };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  log(`wired into ${settingsPath}`);

  log("installed. Restart Claude Code (close and reopen your terminal) to see it live.");
  log("to check earnings or register a payout email later, run:");
  log(`  ${python} "${scriptPath}" --claim`);

  // Open the browser straight to the claim page -- same pattern as
  // `gh auth login` / `vercel login` / `wrangler login`. This is the only
  // honest way for the site to know an install actually happened: it
  // fires because this really did just write a real install ID, not
  // because someone merely copied a command.
  const claimUrl = `${SERVER}/claim.html?id=${installId}`;
  openUrl(claimUrl);
  log(`if a browser tab didn't open: ${claimUrl}`);
}

main().catch((err) => {
  console.error(`meanwhile: install failed -- ${err.message}`);
  process.exit(1);
});
