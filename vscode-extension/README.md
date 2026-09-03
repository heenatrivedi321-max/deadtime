# Meanwhile

A quiet line in your VS Code status bar while you code. Occasionally it's a
clearly disclosed **sponsor** line instead — and half of what that sponsor
pays goes to you.

> Not affiliated with meanwhile.cash. This is the no-crypto, flat-rate
> version — payouts in real dollars via PayPal, no wallet required.

## What this actually does

Meanwhile adds one item to your status bar. While you're actively editing
(real keystrokes, not just VS Code sitting open in the background), it
rotates between:

- short, quiet filler lines, and
- occasional lines marked **(sponsored)**, which is the only kind that
  earns you anything.

Nothing is ever unlabeled. If a line isn't marked "(sponsored)," it isn't a
sponsor line, and no money changed hands for you seeing it.

## What this does *not* do

This extension does not read, inspect, or hook into GitHub Copilot, Copilot
Chat, or any other AI extension you may have installed. It has no way to —
VS Code doesn't currently expose a public API for a third-party extension to
observe another extension's internal state (Copilot's "is it generating a
response right now" state included). So this isn't "a sponsor line while
Copilot thinks" — it's "a quiet line while you're actively coding," full
stop, regardless of which AI tools (if any) you also use. If that
distinction matters to you, now you know it up front.

It also never patches, modifies, or reads the files of any other extension.
It only ever touches its own status bar item, using VS Code's standard,
public `vscode.window.createStatusBarItem` API.

## What data this sends

- A random anonymous ID, generated locally on first run and stored at
  `~/.deadtime/install_id`. Not tied to your name, GitHub account, or
  anything else about you.
- Which line was shown (filler or sponsor), so the sponsor line can be
  billed correctly and your share credited.

That's it. Your code, file contents, and editor activity itself never leave
your machine — only the fact that *some* activity happened recently is used
locally to decide whether to poll at all.

If you also use the Claude Code or GitHub Copilot CLI versions of Meanwhile,
they share the same install ID and the same balance — one identity, not
three separate accounts to track.

## Getting paid

Run the **Meanwhile: Check Earnings** command from the Command Palette
(`Cmd+Shift+P` / `Ctrl+Shift+P`), or click the status bar item, to open your
account page and register a payout email. Once your balance crosses $25,
PayPal sends it automatically.

## Links

- [trymeanwhile.online](https://trymeanwhile.online/install) — full site
- [Privacy policy](https://trymeanwhile.online/privacy)
- [Terms](https://trymeanwhile.online/terms)
- [Source](https://github.com/heenatrivedi321-max/deadtime)

## Uninstalling

Uninstall the extension like any other. Nothing is left behind except the
`~/.deadtime/install_id` file (harmless, just a random ID with no way to
identify you) — delete it by hand if you want it fully gone.
