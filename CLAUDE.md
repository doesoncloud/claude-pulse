# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension (TypeScript + esbuild). A status bar indicator showing
the **exact %** of Claude Code's rate-limit window used — the status detail
lives in the **tooltip** (hover, anchored to the status bar; it's the only
real position VS Code lets you anchor there), with a small embedded animated
pulse GIF (colored by severity) as a decorative, non-primary detail. See
`README.md` § "How it gets the exact %" for the full mechanism — summary: it
probes `claude -p --no-session-persistence` with `ANTHROPIC_LOG=debug` and
parses the real `anthropic-ratelimit-unified-*` headers from Anthropic's
response (not a token-based estimate). The $ cost is still estimated locally
from `~/.claude/projects/**/*.jsonl`, and is only shown if the session uses a
pay-per-token API key (not with a subscription, where it doesn't apply).

Clicking the status bar icon opens a separate **action menu** — a webview
panel with 5 buttons (resume in terminal, claude.ai, usage console, cost
ranking, burn-rate projection). See README § "Action menu" for why it's a
docked panel and not a floating popup (VS Code's extension API has no
anchored-popup primitive for extensions).

The cost ($) logic is a self-contained client-side TypeScript implementation
that reads `~/.claude/projects/**/*.jsonl` locally — no dependency on any
external service or backend, built with Marketplace publishing in mind.

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
  into 5h/24h/7d windows (`buildStats`) or grouped by project
  (`buildProjectRanking`, keyed by the top-level directory name under
  `~/.claude/projects` — the only stable project identifier available, since
  Claude Code stores it as a slugified cwd path, not the original path).
  Source of the **cost** ($), not the %. Testable in isolation.
- `src/preciseUsage.ts` — pure layer with no `vscode` dependency:
  `probeExactUsage()` runs `claude -p` and parses the
  `anthropic-ratelimit-unified-*` headers from the debug log. Source of the
  **exact %**. Testable in isolation (`execFile` is mockable).
- `src/pulseAssets.ts` — 4 pulse GIFs (blue/green/yellow/orange, ~20KB each)
  generated with Pillow and embedded as base64. Static, no automated build
  script — regenerate by hand if the design changes (see the comment in the
  file itself).
- `src/extension.ts` — VS Code layer: `StatusBarItem` (text + `tooltip`
  `MarkdownString` for the status detail), `claudePulse.openMenu` command
  (clicking the bar toggles the action-menu panel; `claudePulse.refresh`
  remains available from the Command Palette for a manual refresh), two
  independent timers (`localTick` every `refreshIntervalSeconds` for
  cost/tokens, `probeTick` every `preciseProbeIntervalSeconds` for the exact
  %) — deliberately decoupled: the exact % is expensive to refresh (a real
  call), the local cost is free. Also wires up `ProjectionTracker` and
  `ThresholdNotifier` (see below) on every `render()`.
- `src/menuView.ts` — `ClaudePulseMenuViewProvider`, a `WebviewViewProvider`
  contributed to a dedicated panel container (`contributes.viewsContainers.panel`
  in `package.json`, id `claudePulsePanel`). Renders the 5-button menu and two
  in-panel detail views (cost ranking, projection) via `postMessage` —
  no separate webview panel/tab per action, everything lives in one view
  that swaps its own content client-side.
- `src/icons.ts` — inline SVG strings for the 5 menu buttons, stroke-based
  and `currentColor`-driven so they follow the button's theme automatically.
  `claudeWeb`/`resumeTerminal` are original marks, not a reproduction of
  Anthropic's actual logo (trademark/brand reasons — the user explicitly
  chose this over embedding a real logo asset).
- `src/projection.ts` — `ProjectionTracker` (in-memory rolling sample buffer,
  no persistence across VS Code restarts — computes a burn-rate estimate
  from the last ~30 min of `pct` samples) and `ThresholdNotifier` (fires a
  one-shot `showWarningMessage` the first time usage crosses each configured
  threshold per 5h window, tracked by `resetTarget5h().toISOString()` as the
  window key).

## Pricing conventions

Prices in `PRICING` (`src/usage.ts`) are USD/token, derived from Anthropic's
official pricing table (input/output) plus the standard cache ratio (write
≈1.25x input, read ≈0.1x input). When adding a new model, look up the
current rate on Anthropic's official pricing page — don't make up prices.
