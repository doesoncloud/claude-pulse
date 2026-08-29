# Claude Pulse

**A real-time indicator, right in VS Code's own status bar, of the exact %
you've used of your Claude Code usage window — with the real figure
Anthropic uses, not an estimate.**

If you use Claude Code daily, you've probably already hit the surprise of
getting cut off mid-task because you ran out of your 5-hour window without
noticing. Claude Pulse puts that number in view, all the time, without
leaving the editor.

![Pulse example in orange, near the limit](docs/media/pulse-orange.gif)

## What it does

- A status bar icon (bottom-right corner) with a **progress bar** and the
  **% of the 5-hour rate-limit window**.
- The icon and bar **change color** based on how much you've used — at a
  glance, without having to read the number.
- Hovering shows a **rich tooltip** with the detail: % of the 5h and 7-day
  windows, countdown to the next reset, requests made, and cost in $ (if
  applicable — see below).
- Zero telemetry, zero network calls except the query to Anthropic itself to
  read your real usage figure. Everything else is computed locally.

## The figure is exact, not an estimate

This is what sets Claude Pulse apart: **it doesn't count tokens to guess a
percentage**. Anthropic doesn't publish the exact limit of the 5-hour window
anywhere — any extension that tries to compute it from tokens is guessing.

Instead, Claude Pulse asks Anthropic directly: every authenticated API
response includes headers (`anthropic-ratelimit-unified-5h-utilization`,
`-7d-utilization`) with the **real, server-computed percentage** — the same
data used by Claude Code's own `/usage` command. Claude Pulse periodically
runs a minimal query (`claude -p "1" --no-session-persistence`, leaving no
trace in your session history, real cost ≈$0.0002 per query) and reads those
headers. Every 60 seconds by default.

If that query fails (no connection, outdated CLI), Claude Pulse falls back
to a local estimate based on your sessions — and says so explicitly in the
tooltip (it never presents an estimate as if it were the exact figure).

## Color scale

| Color | Range | What it means |
|---|:---:|---|
| 🔵 Blue | 0–19% | You've barely started the window. Relax. |
| 🟢 Green | 20–39% | Normal usage, nothing to worry about. |
| 🟡 Yellow | 40–59% | You're halfway through — worth watching your pace if there's a long task ahead. |
| 🟠 Orange | 60–100% | You're approaching the limit. If the reset is far off, it's a good time to plan a break. |

### Examples

| | | | |
|:---:|:---:|:---:|:---:|
| ![Blue](docs/media/pulse-blue.gif) | ![Green](docs/media/pulse-green.gif) | ![Yellow](docs/media/pulse-yellow.gif) | ![Orange](docs/media/pulse-orange.gif) |
| **12%** · relaxed | **34%** · normal usage | **52%** · moderate usage | **88%** · near the limit |

Here's how it looks in the status bar (illustrative text — the bar actually
uses sub-character-resolution Unicode blocks, more precise than a simple
full/empty toggle):

```
🔵  ▍·······   12% · 4h 48m left
🟢  ▉▉▍·····   34% · 3h 12m left
🟡  ▉▉▉▉▍···   52% · 2h 20m left
🟠  ▉▉▉▉▉▉▉▍   88% · 41m left
```

## Cost in $ — only when it matters

If you use **Claude Code with a subscription** (Pro/Max/Team), cost in
dollars isn't actionable information — you pay a fixed plan, not per token.
In that case Claude Pulse hides it from the main view and shows instead the
time remaining until the next reset — the figure you can actually use to
plan.

If instead you use a **pay-per-token API key**, cost is real money —
Claude Pulse detects this automatically (`claude auth status`) and shows it
in the tooltip: spend over the last 5h, 24h, 7 days, and all-time, computed
from your local sessions and Anthropic's official pricing table.

## Installation

Not yet published to the Marketplace (coming in a later release). In the
meantime, install it from the `.vsix`:

```bash
git clone https://github.com/doesoncloud/claude-pulse.git
cd claude-pulse
npm install
npm run package                      # generates claude-pulse-<version>.vsix
code --install-extension claude-pulse-<version>.vsix
```

Reload VS Code (`Developer: Reload Window`) and look for the icon in the
bottom-right corner of the status bar.

## Configuration

| Setting | Default | What it does |
|---|---|---|
| `claudePulse.preciseMode` | `true` | Polls Anthropic for the exact %. Off = local estimate only, no `claude` execution. |
| `claudePulse.preciseProbeIntervalSeconds` | `60` | How often the exact % is polled (minimum 30s). |
| `claudePulse.claudeBinaryPath` | `""` | Path to the `claude` binary if it's not on VS Code's PATH. |
| `claudePulse.tokenLimit5h` | `88000` | Fallback only, if `preciseMode` is off or the probe fails. |
| `claudePulse.refreshIntervalSeconds` | `15` | How often local session data is re-read (cost/tokens 24h-7d). |
| `claudePulse.displayMode` | `both` | `percent` \| `cost` \| `both` in the status bar text. |
| `claudePulse.projectsDir` | `""` (autodetect) | Override for `~/.claude/projects`. |

## Requirements

- VS Code 1.85 or later.
- [Claude Code](https://code.claude.com) installed and authenticated (`claude auth login`) — Claude Pulse uses it as the source of the exact figure, it doesn't ship its own authentication.

## Development

```bash
npm install
npm run watch     # esbuild in watch mode
npm run check     # type checking (tsc --noEmit)
npm run package   # generates the .vsix (includes a Node 18 workaround, see below)
```

Press **F5** in VS Code to open an "Extension Development Host" with the
extension hot-loaded.

Architecture details, design decisions, and why certain UI surfaces (a
docked panel, a floating flyout) were evaluated and dropped: see
[`CLAUDE.md`](CLAUDE.md).

### Note: Node 18

Recent `@vscode/vsce` pulls in `undici`, which on Node 20+ uses the global
`File` — on Node 18 it doesn't exist and `vsce package` fails with
`ReferenceError: File is not defined`. `npm run package` already includes
the workaround (`scripts/node18-file-shim.js`).

## How it gets the exact figure (technical detail)

Every authenticated response from `/v1/messages` includes, among its HTTP
headers, the account's rate-limit window status — the account's, not the
model's:

```
anthropic-ratelimit-unified-5h-utilization: 0.37
anthropic-ratelimit-unified-5h-reset: 1787928000
anthropic-ratelimit-unified-7d-utilization: 0.18
anthropic-ratelimit-unified-7d-reset: 1788375600
```

Claude Pulse doesn't reimplement Claude Code's OAuth client to read these
headers directly (that would be fragile and would touch credentials it has
no business touching) — instead, it periodically runs the already-
authenticated `claude` CLI on your machine with `ANTHROPIC_LOG=debug` and
`--no-session-persistence`, and parses the header from its debug output.
It's slower (~1-2s per poll) than a direct HTTP call, but doesn't require
managing tokens.

## License

MIT
