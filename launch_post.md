# Distribution checklist — do these in order

1. **Today: Show HN.** It's the highest-leverage one and the fastest to try again. If it got blocked before, it was very likely a new-account rate limit ("you're posting too fast" / karma threshold), not a permanent ban — HN enforces this on new accounts submitting their first few posts close together. Wait a day or two from your last attempt if you haven't, then try the draft below.
2. **Same day: IndieHackers.** Zero stigma around self-promotion here — it's the entire culture. Post as a "milestone" or "product" update, not a pitch.
3. **Same week: r/ClaudeAI and r/SideProject.** Check each sub's rules first — some require a specific flair or a self-promo day. Tailor the opening line to the sub (drafts below).
4. **Ongoing: Twitter/X.** Post the thread below from your own account. Reply to it yourself with the constellation GIF/screenshot once you have one. Consider @-ing a couple of Claude Code creators who post build-in-public content — don't cold-pitch, just make the post good enough to get organically shared into their feed.
5. **Optional, later: Product Hunt.** Save this for once you have a small number of real installs already (even 20–30) — Product Hunt rewards momentum, launching to zero existing users is the weakest use of it.

All copy below is current as of today — correct install command, no more "pre-launch" hedging since the mechanism is live, mentions the automated payout and the connect.html walkthrough. Paste and post yourself; I can't post on your behalf.

---

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
break on an update. The server only ever sees an anonymous ID and which line
was shown — never your prompts, your code, or anything about your session.

One command:

    curl -fsSL https://deadtime-server.bean-picker.workers.dev/install.sh | bash

Billing is honest by construction: a line only counts as a billable
impression once it's been continuously on screen for 10 real seconds since
the last actual Claude Code event (a new message, session start, etc.) — not
a blind timer, so idle open terminals don't rack up fake numbers.

Payouts run automatically once a day via PayPal once your balance crosses
$25 — no manual step on my end. Advertiser side is flat $2 CPM, self-serve,
activates automatically the moment payment clears:
https://deadtime-server.bean-picker.workers.dev/advertiser

If you've never touched Claude Code's statusLine setting before, there's a
plain-English walkthrough here: https://deadtime-server.bean-picker.workers.dev/connect

Everything's open: https://github.com/heenatrivedi321-max/deadtime

Would love feedback, especially from anyone who's actually looked at what
Kickbacks' extension does under the hood.

---

# IndieHackers draft

**Title:** I rebuilt a controversial "get paid while your AI thinks" tool, minus the sketchy parts

Kickbacks.ai went semi-viral for patching Claude Code's spinner to show ads
and splitting the revenue with developers. Cool mechanic, but it patches
client code that isn't meant to be touched, and its "Boosted Mode" sends
your actual prompts to ad servers for a better rate.

I built the same core idea on Claude Code's real, supported `statusLine`
setting instead — same 50/50 split, same disclosed sponsor lines, but the
server literally cannot see your code or prompts, only an anonymous ID and
which line was shown.

It's fully live: real Cloudflare Worker backend, real event-driven billing
(not a blind timer), real PayPal integration on both sides — advertisers pay
in, campaigns activate automatically, developers get paid out automatically
once a day past $25, no manual step from me on either end.

Install: `curl -fsSL https://deadtime-server.bean-picker.workers.dev/install.sh | bash`
Site: https://deadtime-server.bean-picker.workers.dev/
Code: https://github.com/heenatrivedi321-max/deadtime

What I actually need right now: the first real advertiser, and enough real
developers running it that the network stats mean something. Happy to
answer anything about how the billing/payout mechanism works under the hood.

---

# r/ClaudeAI draft

**Title:** Built an honest alternative to Kickbacks.ai (the "ads in your status line" thing) — uses Claude Code's real statusLine, never sees your code

Saw a bunch of people talking about Kickbacks.ai here — the tool that shows
ads in Claude Code's thinking spinner and pays you half. The idea's genuinely
good, but it works by patching the client directly, and its higher-paying
mode ships your prompts to ad-matching servers.

I built the same mechanic properly: uses Claude Code's actual `statusLine`
setting (a real, documented feature, not a patch), and the backend only ever
sees an anonymous ID + which line was shown — never your code, never your
prompts.

One command to try it: `curl -fsSL https://deadtime-server.bean-picker.workers.dev/install.sh | bash`

Fully open source if anyone wants to check the claims themselves:
https://github.com/heenatrivedi321-max/deadtime

Not trying to hard-sell this — genuinely curious what this sub thinks of the
approach, especially anyone who's looked at what Kickbacks does internally.

---

# r/SideProject draft

**Title:** Rebuilt a viral "pay devs to show ads in their AI tool" product without the shady parts it launched with

Saw Kickbacks.ai blow up for putting ads in Claude Code's thinking spinner
and splitting revenue with devs — cool idea, sketchy implementation (patches
client code, ships your prompts to ad servers on its paid tier).

Spent a chunk of time rebuilding the same mechanic the honest way — official
extension point, anonymous billing only, real automated PayPal payouts on
both the advertiser and developer side. Whole thing's live and open source.

https://deadtime-server.bean-picker.workers.dev/
https://github.com/heenatrivedi321-max/deadtime

Would love eyes on it — especially the billing logic (event-driven, not a
blind timer) and the payout automation (real Cloudflare Cron, not a manual
monthly batch).

---

# Twitter/X thread draft

**Tweet 1:**
Kickbacks.ai went viral for putting ads in Claude Code's thinking spinner
and splitting revenue with developers.

Cool idea. Sketchy build — it patches client code and ships your prompts to
ad servers on its paid tier.

I rebuilt it properly. 🧵

**Tweet 2:**
Same mechanic: a disclosed sponsor line in your status bar while Claude
Code works, you get 50% of the revenue.

Different foundation: built on Claude Code's actual `statusLine` setting —
a real, documented feature. Nothing patched. Can't silently break on an
update.

**Tweet 3:**
The server only ever sees two things: an anonymous ID, and which line was
shown. Never your code. Never your prompts. Technically can't — that's not
what the client sends.

**Tweet 4:**
Billing is honest by construction — a line only counts once it's been on
screen for 10 real seconds since the last actual Claude Code event. Not a
blind timer running in the background.

**Tweet 5:**
Payouts run automatically, once a day, straight to PayPal, once you cross
$25. No manual step on my end — real Cloudflare Cron Trigger, not "I'll get
to it eventually."

**Tweet 6:**
One command:
`curl -fsSL https://deadtime-server.bean-picker.workers.dev/install.sh | bash`

Open source: https://github.com/heenatrivedi321-max/deadtime
Site: https://deadtime-server.bean-picker.workers.dev/

If you run Claude Code, would genuinely love for you to try it and tell me
what breaks.

---

# Product Hunt draft (save for later, per the checklist above)

**Tagline:** Get paid while your AI coding agent thinks — the honest way.

**Description:**

A status line for Claude Code that shows useful tips most of the time, and
occasionally a disclosed, relevant sponsor line — you get half the revenue.

Built on Claude Code's official `statusLine` setting (nothing patched, can't
silently break), and the server never sees your prompts or code — only an
anonymous ID and which line was shown.

One command to install. No account. No payment info. Uninstall by deleting
one line from your settings file. Payouts run automatically once a day via
PayPal once you cross $25.

[Try it](https://deadtime-server.bean-picker.workers.dev/) ·
[Sponsor a line](https://deadtime-server.bean-picker.workers.dev/advertiser) ·
[Source](https://github.com/heenatrivedi321-max/deadtime)
