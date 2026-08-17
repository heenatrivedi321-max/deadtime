# deadtime

Get paid while your AI coding agent thinks.

One line in your Claude Code status bar. Mostly useful tips. Sometimes a
disclosed, relevant sponsor line. You get half of every sponsored line
shown — tracked honestly, server-side, only after it's been continuously
on screen for 10 seconds (not per script call).

Built on Claude Code's official `statusLine` setting — nothing is patched.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/heenatrivedi321-max/deadtime/main/install.sh | bash
```

Restart Claude Code afterward to see it live.

## How it works

- `statusline.py` -- the client. Generates a random anonymous install ID,
  asks the server for a line, prints it. Never sees or sends your prompts,
  code, or conversation content.
- `worker/` -- the Cloudflare Worker backend. Picks tip vs. sponsor per
  install, enforces the 2-in-5 sponsor ceiling, only bills an impression
  once a line has been continuously shown for 10 seconds.
- `site/` -- the two public pages: `install.html` (for developers) and
  `advertiser.html` (for sponsors).

## For sponsors

See the [advertiser page](site/advertiser.html) -- reserve a spot, no
payment required yet, real numbers before any charge.

## Privacy

The server only ever receives: a random install ID, and which line was
shown. No prompts, no code, no conversation content, ever.
