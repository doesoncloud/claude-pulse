# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension (TypeScript + esbuild). A status bar indicator showing
the **exact %** of Claude Code's rate-limit window used — the detail lives
in the **tooltip** (hover, anchored to the status bar; it's the only real
position VS Code lets you anchor there, see README § "Why there's no
flyout/panel"), with a small embedded animated pulse GIF (colored by
severity) as a decorative, non-primary detail. See `README.md` § "How it
gets the exact %" for the full mechanism — summary: it probes
`claude -p --no-session-persistence` with `ANTHROPIC_LOG=debug` and parses
the real `anthropic-ratelimit-unified-*` headers from Anthropic's response
(not a token-based estimate). The $ cost is still estimated locally from
`~/.claude/projects/**/*.jsonl`, and is only shown if the session uses a
pay-per-token API key (not with a subscription, where it doesn't apply).

The cost ($) logic reuses the same approach as
`~/stacks/claude-dash/app/app.py` (the homelab's Flask dashboard) but ported
to client-side TypeScript, with no dependency on that service — built with
Marketplace publishing in mind.

## Commands

```bash
npm install
npm run watch     # esbuild in watch mode (used by F5 / Run Extension)
npm run build     # production build (minified)
npm run check     # tsc --noEmit, type checking
npm run package   # vsce package -> generates the .vsix
```

Manual test: F5 in VS Code opens the Extension Development Host with the extension loaded.

## Architecture

- `src/usage.ts` — pure layer with no `vscode` dependency: reads the `.jsonl`
  files, computes per-model cost (`PRICING`, embedded table), and aggregates
  into 5h/24h/7d windows (`buildStats`). Source of the **cost** ($), not the
  %. Testable in isolation.
- `src/preciseUsage.ts` — pure layer with no `vscode` dependency:
  `probeExactUsage()` runs `claude -p` and parses the
  `anthropic-ratelimit-unified-*` headers from the debug log. Source of the
  **exact %**. Testable in isolation (`execFile` is mockable).
- `src/pulseAssets.ts` — 4 pulse GIFs (blue/green/yellow/orange, ~20KB each)
  generated with Pillow and embedded as base64. Static, no automated build
  script — regenerate by hand if the design changes (see the comment in the
  file itself).
- `src/extension.ts` — VS Code layer: `StatusBarItem` (text + `tooltip`
  `MarkdownString` as the only detail view — no QuickPick, no webview),
  `claudePulse.refresh` command (clicking the bar = manual refresh), two
  independent timers (`localTick` every `refreshIntervalSeconds` for
  cost/tokens, `probeTick` every `preciseProbeIntervalSeconds` for the exact
  %) — deliberately decoupled: the exact % is expensive to refresh (a real
  call), the local cost is free.

## Pricing conventions

Prices in `PRICING` (`src/usage.ts`) are USD/token, derived from Anthropic's
official pricing table (input/output) plus the standard cache ratio (write
≈1.25x input, read ≈0.1x input). When adding a new model, use the
`claude-api` skill from this same repo (`/data/projects/`) for the current
rate — don't make up prices.
