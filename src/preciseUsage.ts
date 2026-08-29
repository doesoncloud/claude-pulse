import { execFile } from "node:child_process";

export interface PreciseWindow {
  utilizationPct: number; // 0-100, exactly as computed by Anthropic (not a local estimate)
  resetAt: Date;
  status: string; // "allowed" | "rejected" | ...
}

export interface PreciseUsage {
  fiveHour: PreciseWindow;
  sevenDay: PreciseWindow;
  overallStatus: string;
  probedAt: Date;
}

export type ProbeResult = { ok: true; usage: PreciseUsage } | { ok: false; reason: string };

/**
 * Detects whether the session uses a subscription (Pro/Max/Team, via `claude.ai`
 * OAuth — $ cost is meaningless, it's a fixed plan) or a pay-per-token API key
 * (where $ cost is actually actionable information).
 * Best-effort: if `claude auth status` fails or isn't JSON, assumes subscription
 * (the more conservative behavior: hide the cost instead of showing a
 * potentially irrelevant one).
 */
export function detectUsingApiTokens(claudeBinary: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(claudeBinary, ["auth", "status"], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed.authMethod !== "claude.ai");
      } catch {
        resolve(false);
      }
    });
  });
}

const PROBE_TIMEOUT_MS = 20_000;
const PROBE_MODEL = "claude-haiku-4-5-20251001"; // cheapest — the probe only reads headers, the response doesn't matter

function extractHeaderNumber(text: string, header: string): number | null {
  const re = new RegExp(`"${header}":\\s*"([\\d.]+)"`);
  let match: RegExpExecArray | null;
  let last: string | null = null;
  const global = new RegExp(re.source, "g");
  while ((match = global.exec(text)) !== null) {
    last = match[1];
  }
  return last === null ? null : Number(last);
}

function extractHeaderString(text: string, header: string): string | null {
  const global = new RegExp(`"${header}":\\s*"([^"]+)"`, "g");
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = global.exec(text)) !== null) {
    last = match[1];
  }
  return last;
}

/**
 * Runs `claude -p` with ANTHROPIC_LOG=debug and reads the
 * `anthropic-ratelimit-unified-*` headers that Anthropic returns on every
 * authenticated /v1/messages response straight from the debug log. It's the
 * same data Claude Code's internal `/usage` uses — not an estimate derived
 * from tokens.
 *
 * `--no-session-persistence` keeps the probe from leaving transcripts in
 * ~/.claude/projects/ (verified: 0 new files after a probe run).
 *
 * Fragility note: the `ANTHROPIC_LOG=debug` format is an internal debug log,
 * not a stable API — its format can change between `claude` versions. If
 * parsing stops working, the extension automatically falls back to estimate
 * mode (see usage.ts) instead of breaking.
 */
export function probeExactUsage(claudeBinary: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      claudeBinary,
      ["-p", "1", "--model", PROBE_MODEL, "--no-session-persistence"],
      {
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ANTHROPIC_LOG: "debug" },
      },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ ok: false, reason: `"${claudeBinary}" not found on PATH` });
          return;
        }
        const text = `${stdout}\n${stderr}`;

        const pct5h = extractHeaderNumber(text, "anthropic-ratelimit-unified-5h-utilization");
        const reset5h = extractHeaderNumber(text, "anthropic-ratelimit-unified-5h-reset");
        const status5h = extractHeaderString(text, "anthropic-ratelimit-unified-5h-status");
        const pct7d = extractHeaderNumber(text, "anthropic-ratelimit-unified-7d-utilization");
        const reset7d = extractHeaderNumber(text, "anthropic-ratelimit-unified-7d-reset");
        const status7d = extractHeaderString(text, "anthropic-ratelimit-unified-7d-status");
        const overallStatus = extractHeaderString(text, "anthropic-ratelimit-unified-status");

        if (pct5h === null || reset5h === null || pct7d === null || reset7d === null) {
          resolve({
            ok: false,
            reason: error
              ? `claude -p failed: ${error.message}`
              : "anthropic-ratelimit-unified-* headers not found in output",
          });
          return;
        }

        resolve({
          ok: true,
          usage: {
            fiveHour: { utilizationPct: pct5h * 100, resetAt: new Date(reset5h * 1000), status: status5h ?? "unknown" },
            sevenDay: { utilizationPct: pct7d * 100, resetAt: new Date(reset7d * 1000), status: status7d ?? "unknown" },
            overallStatus: overallStatus ?? "unknown",
            probedAt: new Date(),
          },
        });
      }
    );
  });
}
