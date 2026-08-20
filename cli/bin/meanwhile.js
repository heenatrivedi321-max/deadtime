#!/usr/bin/env node
// Node reimplementation of install.sh/install.ps1/install_copilot.sh -- one
// script instead of three, since Node itself is already cross-platform and
// can detect which tool(s) are actually installed. Behavior is kept in
// lockstep with those scripts (same install dir, same settings.json shape,
// same non-fatal certifi step) so every installer produces an identical
// result regardless of which one someone happens to run.

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

function commandExists(cmd) {
  return spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
}

function findPython() {
  for (const candidate of ["python3", "python", "py"]) {
    if (commandExists(candidate)) return candidate;
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

async function ensureCertifi(python) {
  const hasCertifi = spawnSync(python, ["-c", "import certifi"], { stdio: "ignore" }).status === 0;
  if (hasCertifi) return;
  // certifi is a nice-to-have, not a hard requirement -- both status line
  // scripts fall back to the system's own certificate store if it's
  // missing. Never let a failed pip install here take down the install.
  log("installing certifi (helps with HTTPS, not required)...");
  const pipAttempts = [
    ["-m", "pip", "install", "--quiet", "certifi"],
    ["-m", "pip", "install", "--quiet", "--user", "certifi"],
    ["-m", "pip", "install", "--quiet", "--break-system-packages", "certifi"],
  ];
  const installed = pipAttempts.some((args) => spawnSync(python, args, { stdio: "ignore" }).status === 0);
  if (!installed) log("couldn't install certifi, continuing without it (falls back automatically)");
}

async function downloadTo(remoteName, localPath) {
  const res = await fetch(`${SERVER}/${remoteName}`);
  if (!res.ok) throw new Error(`couldn't download ${remoteName} (${res.status})`);
  fs.writeFileSync(localPath, await res.text());
}

function wireSettings(settingsPath, python, scriptPath) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8") || "{}") : {};
  settings.statusLine = { type: "command", command: `${python} "${scriptPath}"` };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  log(`wired into ${settingsPath}`);
}

async function main() {
  log(`installing to ${INSTALL_DIR}`);
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

  const python = findPython();
  if (!python) {
    log("couldn't find Python on your PATH.");
    log("install it from https://python.org, then run `npx trymeanwhile` again.");
    process.exit(1);
  }
  await ensureCertifi(python);

  // Wire whichever tool(s) are actually on this machine, so the same
  // command works everywhere instead of a different one per tool. Claude
  // Code is always wired -- it's the primary target this package was
  // built for -- and Copilot CLI is wired too if it's detected on PATH.
  const wireCopilot = commandExists("copilot");

  const claudeScript = path.join(INSTALL_DIR, "statusline.py");
  await downloadTo("statusline.py", claudeScript);
  wireSettings(path.join(os.homedir(), ".claude", "settings.json"), python, claudeScript);

  if (wireCopilot) {
    const copilotScript = path.join(INSTALL_DIR, "copilot_statusline.py");
    await downloadTo("copilot_statusline.py", copilotScript);
    wireSettings(path.join(os.homedir(), ".copilot", "settings.json"), python, copilotScript);
    log("Copilot CLI detected -- wired that too, same install ID, earnings share one balance.");
  }

  log("installed. Restart Claude Code (and Copilot CLI, if wired) to see it live.");
  log("to check earnings or register a payout email later, run:");
  log(`  ${python} "${claudeScript}" --claim`);

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
