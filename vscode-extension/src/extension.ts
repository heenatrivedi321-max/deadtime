import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";

const SERVER_URL = "deadtime-server.bean-picker.workers.dev";
const FALLBACK_LINE = "meanwhile: agent working...";
// How often we're willing to poll while the user is actively coding. Kept
// well above the server's 10s real-dwell billing threshold so a poll is
// never wasted -- and short enough that a sponsor line doesn't sit stale.
const POLL_INTERVAL_MS = 20_000;
// A poll only fires if there was a real edit within this window -- an idle
// VS Code window sitting open in the background must never bill or fetch.
const ACTIVITY_FRESHNESS_MS = 30_000;

function getInstallId(): string {
  const dir = path.join(os.homedir(), ".deadtime");
  const file = path.join(dir, "install_id");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8").trim();
  }
  const id = crypto.randomUUID();
  fs.writeFileSync(file, id);
  try {
    // Same rationale as the Python adapters: this ID is a real credential
    // (it's what /register-payout trusts), default permissions are
    // world-readable on a shared machine.
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort, same as the Python clients
  }
  return id;
}

function fetchLine(installId: string, eventName: string): Promise<string> {
  return new Promise((resolve) => {
    const query = `id=${encodeURIComponent(installId)}&event=${encodeURIComponent(eventName)}`;
    const req = https.get(
      { host: SERVER_URL, path: `/line?${query}`, timeout: 6000, headers: { "User-Agent": "deadtime-client/1.0" } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve(typeof data.line === "string" ? data.line : FALLBACK_LINE);
          } catch {
            resolve(FALLBACK_LINE);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(FALLBACK_LINE));
  });
}

export function activate(context: vscode.ExtensionContext) {
  const installId = getInstallId();

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = "Meanwhile";
  statusBarItem.command = "meanwhile.claim";
  statusBarItem.text = "meanwhile: waiting for activity...";
  statusBarItem.tooltip = "Meanwhile -- click to check what you've earned";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("meanwhile.claim", () => {
      vscode.env.openExternal(vscode.Uri.parse(`https://${SERVER_URL}/claim?id=${installId}`));
    })
  );

  let lastActivityAt = 0;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      lastActivityAt = Date.now();
    })
  );

  const poll = async () => {
    const windowFocused = vscode.window.state.focused;
    const recentlyActive = Date.now() - lastActivityAt < ACTIVITY_FRESHNESS_MS;
    if (!windowFocused || !recentlyActive) return;

    const line = await fetchLine(installId, "vscode:activity");
    statusBarItem.text = line.length > 80 ? line.slice(0, 77) + "..." : line;
    statusBarItem.tooltip = line;
  };

  const interval = setInterval(poll, POLL_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

export function deactivate() {}
