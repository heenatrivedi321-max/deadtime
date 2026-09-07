# Meanwhile

Adds a disclosed, revenue-sharing status line to Claude Code. While your
agent is thinking, the status line shows a plain tip most of the time, and
occasionally a clearly labeled sponsor line. Sponsor lines are always
marked as sponsored -- never hidden as regular content. Meanwhile splits
what a sponsor line earns with you, 50/50, paid out automatically.

## What this plugin does

On first session start after install, it:

- Downloads `statusline.js` from `trymeanwhile.online`
- Wires it into your Claude Code `statusLine` setting (the same supported
  config Claude Code already has -- nothing patches your machine)
- Generates a random install ID stored locally at `~/.deadtime/install_id`
- Opens your browser to a claim page where you can register a payout email

Every session after that, the setup hook checks the wiring is intact and
exits immediately -- no network call, no output.

## Privacy

Meanwhile never reads your code or your prompts. The only signal sent to
the server is that a line was shown, and for how long -- that's the whole
billing mechanism.

## Check earnings

```
npx trymeanwhile claim
```

## Links

- Site: https://trymeanwhile.online
- Source: https://github.com/heenatrivedi321-max/deadtime
