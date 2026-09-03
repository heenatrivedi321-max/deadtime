import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";

const SERVER_URL = "trymeanwhile.online";
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

/** Real evidence a genuine coding session is behind this poll, not a
 * script pinging on a timer. VS Code has no LLM cost/token concept the
 * way Claude Code's stdin JSON does -- the equivalent real signal here
 * is a monotonically increasing count of actual document edits (a
 * script with no editor attached has no way to produce this) plus a
 * hash of the open workspace path, mirroring statusline.py's cwd_hash
 * without ever sending the real path. */
interface SessionEvidence {
  sessionId: string;
  editCount: number;
  cwdHash: string;
}

// Same idea as the CLI clients' local tip generation (see statusline.js):
// some fraction of "tip" slots get composed right here, from signals
// that never leave this machine for this purpose -- no network call, no
// model. editCount is the one genuinely real local signal VS Code has
// that the CLI clients don't (there's no dollar cost to reference here,
// VS Code has no concept of Claude's token pricing), so it stands in
// for statusline.js's cost/token templates.
const LOCAL_TIP_CHANCE = 0.4;
const LOCAL_GENERIC_TIPS = [
  "This one didn't come from our servers. It came from your machine.",
  "Nobody but you and this terminal ever saw this line get made.",
  "No round trip for this one -- just you, right now.",
];

// Position derives from the real wall clock, not a stored counter --
// see statusline.js's generateFlyingEmojiLine for why: every refresh
// lands wherever the "flight" genuinely should be at that instant.
const FLYING_EMOJIS = ["\u{1F426}", "\u{1F680}", "✈️", "\u{1F388}", "\u{1F98B}"];
const RUNWAY_WIDTH = 26;
function generateFlyingEmojiLine(): string {
  const emoji = FLYING_EMOJIS[Math.floor(Date.now() / 4000) % FLYING_EMOJIS.length];
  const period = 2 * (RUNWAY_WIDTH - 1);
  const t = Math.floor(Date.now() / 250) % period;
  const pos = t <= RUNWAY_WIDTH - 1 ? t : period - t;
  return "-".repeat(pos) + emoji + "-".repeat(RUNWAY_WIDTH - 1 - pos);
}

function generateLocalTip(evidence: SessionEvidence): string {
  const hour = new Date().getHours();
  const candidates: string[] = [generateFlyingEmojiLine()];
  if (evidence.editCount > 40) {
    candidates.push(`${evidence.editCount} real edits this session. Still going.`);
  }
  if (hour >= 0 && hour < 5) {
    candidates.push(`It's past midnight where you are. The agent doesn't know that. You do.`);
  } else if (hour >= 5 && hour < 9) {
    candidates.push(`Early. Whatever you're building, you started before most people were up.`);
  }
  candidates.push(...LOCAL_GENERIC_TIPS);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function fetchLine(installId: string, eventName: string, evidence: SessionEvidence): Promise<string> {
  return new Promise((resolve) => {
    const query =
      `id=${encodeURIComponent(installId)}&event=${encodeURIComponent(eventName)}` +
      `&sid=${encodeURIComponent(evidence.sessionId)}` +
      `&tok=${evidence.editCount}` +
      `&cwd=${encodeURIComponent(evidence.cwdHash)}`;
    const req = https.get(
      { host: SERVER_URL, path: `/line?${query}`, timeout: 6000, headers: { "User-Agent": "deadtime-client/1.0" } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.kind === "tip" && Math.random() < LOCAL_TIP_CHANCE) {
              resolve(generateLocalTip(evidence));
              return;
            }
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

  const sessionId = crypto.randomUUID();
  const cwdHash = crypto
    .createHash("sha256")
    .update((vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath).join("|"))
    .digest("hex")
    .slice(0, 16);

  let lastActivityAt = 0;
  // Real edits only -- contentChanges is empty for cursor moves, selection
  // changes, and other non-edit events, which would otherwise let this
  // counter advance without any actual typing behind it.
  let editCount = 0;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) return;
      lastActivityAt = Date.now();
      editCount += 1;
    })
  );

  const poll = async () => {
    const windowFocused = vscode.window.state.focused;
    const recentlyActive = Date.now() - lastActivityAt < ACTIVITY_FRESHNESS_MS;
    if (!windowFocused || !recentlyActive) return;

    const line = await fetchLine(installId, "vscode:activity", { sessionId, editCount, cwdHash });
    statusBarItem.text = line.length > 80 ? line.slice(0, 77) + "..." : line;
    statusBarItem.tooltip = line;
  };

  const interval = setInterval(poll, POLL_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

export function deactivate() {}
