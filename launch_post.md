# Show HN draft

**Title:** Show HN: Meanwhile – get paid while your Claude Code agent thinks

**URL:** https://deadtime-server.bean-picker.workers.dev/

**First comment (post immediately after submitting):**

Hey HN — built this after seeing Kickbacks.ai blow up a couple months back (the
one that sells Claude Code's "thinking…" spinner to advertisers, 50/50 split
with developers). Loved the core idea, didn't love how it's built: it patches
your editor's client code directly (not an officially supported extension
point), and its "Boosted Mode" ships your actual prompts and conversation
content to ad-matching servers to earn a higher rate.

Meanwhile does the same basic thing — a disclosed, relevant line in your
status bar, you get half the ad revenue — but built on Claude Code's actual
supported `statusLine` setting, so nothing is patched and it can't silently
break on an update. And the server only ever sees an anonymous ID and which
line was shown — never your prompts, your code, or anything about your
session.

One command:

    curl -fsSL https://raw.githubusercontent.com/heenatrivedi321-max/deadtime/main/install.sh | bash

Billing is honest by construction: a line only counts as a billable
impression once it's been continuously on screen for 10 real seconds since
the last actual Claude Code event (a new message, session start, etc.) — not
a blind timer, so idle open terminals don't rack up fake numbers.

It's pre-launch — no real advertisers yet, so right now you'll just see
occasional tips instead of sponsor lines. The advertiser side is a flat
$2 CPM, self-serve, no approval process:
https://deadtime-server.bean-picker.workers.dev/advertiser.html

Everything's open: https://github.com/heenatrivedi321-max/deadtime

Would love feedback, especially from anyone who's actually looked at what
Kickbacks' extension does under the hood.

---

# Product Hunt draft

**Tagline:** Get paid while your AI coding agent thinks — the honest way.

**Description:**

A status line for Claude Code that shows useful tips most of the time, and
occasionally a disclosed, relevant sponsor line — you get half the revenue.

Built on Claude Code's official `statusLine` setting (nothing patched, can't
silently break), and the server never sees your prompts or code — only an
anonymous ID and which line was shown.

One command to install. No account. No payment info. Uninstall by deleting
one line from your settings file.

Pre-launch: real mechanism, real payout math, no real advertisers yet —
[reserve a spot](https://deadtime-server.bean-picker.workers.dev/advertiser.html)
if you want to be one of the first.
