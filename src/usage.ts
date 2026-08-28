import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface UsageMessage {
  ts: Date;
  model: string;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface WindowStats {
  requests: number;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  totalTokens: number;
  cost: number;
}

export interface Stats {
  windows: { "5h": WindowStats; "24h": WindowStats; "7d": WindowStats };
  allTime: WindowStats;
  nextResetIso: string | null;
  secsToReset: number | null;
  tokenLimit5h: number;
  pct5h: number;
  lastUpdated: string;
}

interface ModelPricing {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

// USD por token. Cache write/read siguen la proporción estándar de Anthropic
// (write ~1.25x input, read ~0.1x input) salvo que la tarifa oficial diga otra cosa.
// Fuente: tabla de precios vigente de la skill claude-api de este mismo repo.
const PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { input: 10.0, output: 50.0, cacheCreation: 12.5, cacheRead: 1.0 },
  "claude-mythos-5": { input: 10.0, output: 50.0, cacheCreation: 12.5, cacheRead: 1.0 },
  "claude-opus-5": { input: 5.0, output: 25.0, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5.0, output: 25.0, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-7": { input: 5.0, output: 25.0, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-opus-4-6": { input: 5.0, output: 25.0, cacheCreation: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheCreation: 2.5, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheCreation: 1.25, cacheRead: 0.1 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cacheCreation: 1.25, cacheRead: 0.1 },
};
const DEFAULT_PRICING = PRICING["claude-sonnet-5"];
const PER_MILLION = 1_000_000;

function tokenCost(model: string, m: { input: number; output: number; cacheCreation: number; cacheRead: number }): number {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  return (
    (m.input * p.input +
      m.output * p.output +
      m.cacheCreation * p.cacheCreation +
      m.cacheRead * p.cacheRead) /
    PER_MILLION
  );
}

function resolveProjectsDir(override?: string): string {
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(os.homedir(), ".claude", "projects");
}

function walkJsonlFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

/** Lee todos los mensajes `assistant` con `usage` de todos los .jsonl de sesión de Claude Code. */
export function loadMessages(projectsDirOverride?: string): UsageMessage[] {
  const projectsDir = resolveProjectsDir(projectsDirOverride);
  const messages: UsageMessage[] = [];

  for (const file of walkJsonlFiles(projectsDir)) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let d: any;
      try {
        d = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (d?.type !== "assistant") continue;
      const usage = d?.message?.usage;
      if (!usage) continue;
      const model = d?.message?.model ?? "unknown";
      if (model === "<synthetic>") continue;
      const ts = new Date(d.timestamp);
      if (Number.isNaN(ts.getTime())) continue;
      messages.push({
        ts,
        model,
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cacheCreation: usage.cache_creation_input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
      });
    }
  }

  messages.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return messages;
}

function aggregate(msgs: UsageMessage[]): WindowStats {
  const result: WindowStats = { requests: msgs.length, input: 0, output: 0, cacheCreation: 0, cacheRead: 0, totalTokens: 0, cost: 0 };
  for (const m of msgs) {
    result.input += m.input;
    result.output += m.output;
    result.cacheCreation += m.cacheCreation;
    result.cacheRead += m.cacheRead;
    result.totalTokens += m.input + m.output + m.cacheCreation + m.cacheRead;
    result.cost += tokenCost(m.model, m);
  }
  result.cost = Math.round(result.cost * 10000) / 10000;
  return result;
}

export function buildStats(messages: UsageMessage[], tokenLimit5h: number): Stats {
  const now = new Date();
  const cutoff5h = new Date(now.getTime() - 5 * 3600_000);
  const cutoff24h = new Date(now.getTime() - 24 * 3600_000);
  const cutoff7d = new Date(now.getTime() - 7 * 24 * 3600_000);

  const msgs5h = messages.filter((m) => m.ts >= cutoff5h);
  const msgs24h = messages.filter((m) => m.ts >= cutoff24h);
  const msgs7d = messages.filter((m) => m.ts >= cutoff7d);

  const w5h = aggregate(msgs5h);
  const w24h = aggregate(msgs24h);
  const w7d = aggregate(msgs7d);
  const allTime = aggregate(messages);

  let nextResetIso: string | null = null;
  let secsToReset: number | null = null;
  if (msgs5h.length > 0) {
    const oldest = msgs5h[0].ts;
    const nextReset = new Date(oldest.getTime() + 5 * 3600_000);
    if (nextReset > now) {
      nextResetIso = nextReset.toISOString();
      secsToReset = Math.floor((nextReset.getTime() - now.getTime()) / 1000);
    }
  }

  const pct5h = tokenLimit5h > 0 && w5h.output > 0 ? Math.round((w5h.output / tokenLimit5h) * 1000) / 10 : 0;

  return {
    windows: { "5h": w5h, "24h": w24h, "7d": w7d },
    allTime,
    nextResetIso,
    secsToReset,
    tokenLimit5h,
    pct5h,
    lastUpdated: now.toISOString(),
  };
}
