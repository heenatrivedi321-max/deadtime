#!/usr/bin/env node
// SessionStart hook for the Meanwhile plugin. Fires on every session start,
// so it has to be cheap once wired -- checks local state first and only
// touches the network / rewrites settings.json on a genuinely fresh
// install. Reuses the same install-id and statusLine-wiring approach as
// the standalone `npx trymeanwhile` CLI so a plugin install and a CLI
// install are indistinguishable to the server and share one balance.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

const SERVER = "https://trymeanwhile.online";
const INSTALL_DIR = path.join(os.homedir(), ".deadtime-client");
const STATE_DIR = path.join(os.homedir(), ".deadtime");
const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const CLAUDE_SCRIPT = path.join(INSTALL_DIR, "statusline.js");

function openUrl(url) {
  const cmd =
    process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function alreadyWired() {
  if (!fs.existsSync(CLAUDE_SCRIPT)) return false;
  if (!fs.existsSync(SETTINGS_PATH)) return false;
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8") || "{}");
    return !!(settings.statusLine && settings.statusLine.command && settings.statusLine.command.includes("statusline.js"));
  } catch {
    return false;
  }
}

async function downloadTo(remoteName, localPath) {
  const res = await fetch(`${SERVER}/${remoteName}`);
  if (!res.ok) throw new Error(`couldn't download ${remoteName} (${res.status})`);
  fs.writeFileSync(localPath, await res.text());
}

function wireSettings(node) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  const settings = fs.existsSync(SETTINGS_PATH) ? JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8") || "{}") : {};
  settings.statusLine = { type: "command", command: `"${node}" "${CLAUDE_SCRIPT}"`, refreshInterval: 10 };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

async function main() {
  // Cheap path: every session after the first just confirms the wiring is
  // still intact and exits -- no network call, no output, nothing a user
  // sees on ordinary session starts.
  if (alreadyWired()) return;

  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const idPath = path.join(STATE_DIR, "install_id");
  if (!fs.existsSync(idPath)) {
    fs.writeFileSync(idPath, crypto.randomUUID(), { mode: 0o600 });
  }
  const installId = fs.readFileSync(idPath, "utf8").trim();

  await downloadTo("statusline.js", CLAUDE_SCRIPT);
  wireSettings(process.execPath);

  console.log("meanwhile: installed via plugin -- restart not needed, it's live next turn.");
  console.log("meanwhile: privacy -- this never reads your code or prompts, only that a line was shown and for how long.");

  const claimUrl = `${SERVER}/claim.html?id=${installId}`;
  openUrl(claimUrl);
}

main().catch((err) => {
  // A hook failing shouldn't break the session it's attached to -- log to
  // stderr for anyone debugging with --debug, but never throw.
  console.error(`meanwhile: setup hook failed -- ${err.message}`);
});
