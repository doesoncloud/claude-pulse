import * as vscode from "vscode";
import { buildStats, loadMessages, Stats } from "./usage";
import { probeExactUsage, PreciseUsage } from "./preciseUsage";

let statusBarItem: vscode.StatusBarItem;
let localTickTimer: NodeJS.Timeout | undefined;
let probeTimer: NodeJS.Timeout | undefined;
let probeInFlight = false;

let lastLocalStats: Stats | undefined;
let lastPrecise: PreciseUsage | undefined;
let lastProbeError: string | undefined;

const BAR_SEGMENTS = 10;

function renderBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * BAR_SEGMENTS);
  return "█".repeat(filled) + "░".repeat(BAR_SEGMENTS - filled);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatCountdown(target: Date | null): string {
  if (!target) return "sin datos";
  const secs = Math.floor((target.getTime() - Date.now()) / 1000);
  if (secs <= 0) return "reseteando...";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function config() {
  return vscode.workspace.getConfiguration("claudePulse");
}

/** % a mostrar en la barra: exacto de Anthropic si el probe funcionó, si no, estimación local. */
function currentPct5h(): { pct: number; exact: boolean } {
  if (lastPrecise) return { pct: lastPrecise.fiveHour.utilizationPct, exact: true };
  if (lastLocalStats) return { pct: lastLocalStats.pct5h, exact: false };
  return { pct: 0, exact: false };
}

function resetTarget5h(): Date | null {
  if (lastPrecise) return lastPrecise.fiveHour.resetAt;
  if (lastLocalStats?.secsToReset != null) return new Date(Date.now() + lastLocalStats.secsToReset * 1000);
  return null;
}

function render() {
  const cfg = config();
  const displayMode = cfg.get<string>("displayMode", "both");
  const { pct, exact } = currentPct5h();
  const bar = renderBar(pct);
  const cost5h = lastLocalStats?.windows["5h"].cost ?? 0;

  let label = "";
  if (displayMode === "percent") label = `${pct.toFixed(0)}%`;
  else if (displayMode === "cost") label = formatCost(cost5h);
  else label = `${pct.toFixed(0)}% · ${formatCost(cost5h)}`;

  const icon = exact ? "$(pulse)" : "$(pulse) ~";
  statusBarItem.text = `${icon} ${bar} ${label}`;
  statusBarItem.tooltip = buildTooltip(exact);
  statusBarItem.show();
}

function buildTooltip(exact: boolean): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Claude Pulse**\n\n`);

  if (lastPrecise) {
    const agoSecs = Math.floor((Date.now() - lastPrecise.probedAt.getTime()) / 1000);
    md.appendMarkdown(
      `Ventana 5h (**dato exacto de Anthropic**, sondeado hace ${agoSecs}s): **${lastPrecise.fiveHour.utilizationPct.toFixed(1)}%** · reset en ${formatCountdown(lastPrecise.fiveHour.resetAt)}\n\n`
    );
    md.appendMarkdown(
      `Ventana 7d: **${lastPrecise.sevenDay.utilizationPct.toFixed(1)}%** · reset en ${formatCountdown(lastPrecise.sevenDay.resetAt)}\n\n`
    );
    if (lastPrecise.overallStatus !== "allowed") {
      md.appendMarkdown(`⚠️ Estado: **${lastPrecise.overallStatus}**\n\n`);
    }
  } else {
    md.appendMarkdown(`_Sin dato exacto todavía${lastProbeError ? ` (${lastProbeError})` : ""} — mostrando estimación local._\n\n`);
    if (lastLocalStats) {
      md.appendMarkdown(`Ventana 5h (≈ estimado por tokens): **${lastLocalStats.pct5h.toFixed(1)}%**\n\n`);
    }
  }

  if (lastLocalStats) {
    const w5h = lastLocalStats.windows["5h"];
    const w24h = lastLocalStats.windows["24h"];
    const w7d = lastLocalStats.windows["7d"];
    md.appendMarkdown(`**Coste** — 5h: ${formatCost(w5h.cost)} (${w5h.requests} peticiones) · `);
    md.appendMarkdown(`24h: ${formatCost(w24h.cost)} · 7d: ${formatCost(w7d.cost)}\n\n`);
  }

  md.appendMarkdown(`_Click para ver el detalle completo._`);
  return md;
}

function localTick() {
  const cfg = config();
  const tokenLimit5h = cfg.get<number>("tokenLimit5h", 88000);
  const projectsDir = cfg.get<string>("projectsDir", "");
  try {
    const messages = loadMessages(projectsDir || undefined);
    lastLocalStats = buildStats(messages, tokenLimit5h);
  } catch {
    // se mantiene el último dato válido; no rompe la UI por un fallo de lectura puntual
  }
  render();
}

async function probeTick() {
  if (probeInFlight) return;
  const cfg = config();
  if (!cfg.get<boolean>("preciseMode", true)) return;

  probeInFlight = true;
  const claudeBinary = cfg.get<string>("claudeBinaryPath", "") || "claude";
  const result = await probeExactUsage(claudeBinary);
  probeInFlight = false;

  if (result.ok) {
    lastPrecise = result.usage;
    lastProbeError = undefined;
  } else {
    lastProbeError = result.reason;
    // Se conserva el último `lastPrecise` válido (si lo hubo) en vez de descartarlo
    // por un fallo puntual de red/CLI — solo se cae a estimación si nunca hubo probe OK.
  }
  render();
}

async function showDetails() {
  const { pct, exact } = currentPct5h();
  const lines: string[] = [];

  if (lastPrecise) {
    lines.push(
      `5h (exacto): ${lastPrecise.fiveHour.utilizationPct.toFixed(1)}% · reset en ${formatCountdown(lastPrecise.fiveHour.resetAt)}`
    );
    lines.push(
      `7d (exacto): ${lastPrecise.sevenDay.utilizationPct.toFixed(1)}% · reset en ${formatCountdown(lastPrecise.sevenDay.resetAt)}`
    );
  } else {
    lines.push(`5h (≈ estimado): ${pct.toFixed(1)}%${exact ? "" : " — sin dato exacto todavía"}`);
  }

  if (lastLocalStats) {
    const w5h = lastLocalStats.windows["5h"];
    const w24h = lastLocalStats.windows["24h"];
    const w7d = lastLocalStats.windows["7d"];
    lines.push(`Coste 5h: ${formatCost(w5h.cost)} · ${w5h.requests} peticiones`);
    lines.push(`Coste 24h: ${formatCost(w24h.cost)} · ${w24h.requests} peticiones · ${w24h.totalTokens.toLocaleString()} tokens`);
    lines.push(`Coste 7d: ${formatCost(w7d.cost)} · ${w7d.requests} peticiones · ${w7d.totalTokens.toLocaleString()} tokens`);
    lines.push(`Total histórico: ${formatCost(lastLocalStats.allTime.cost)} · ${lastLocalStats.allTime.requests} peticiones`);
  }
  if (lastProbeError) {
    lines.push(`⚠ Último probe falló: ${lastProbeError}`);
  }

  await vscode.window.showQuickPick(lines, {
    title: "Claude Pulse — Detalle de uso",
    placeHolder: "5h/7d exactos vía probe a Anthropic · coste estimado localmente desde ~/.claude/projects",
  });
}

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "claudePulse.showDetails";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(vscode.commands.registerCommand("claudePulse.showDetails", showDetails));
  context.subscriptions.push(
    vscode.commands.registerCommand("claudePulse.refresh", () => {
      localTick();
      void probeTick();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudePulse")) {
        scheduleTimers();
      }
    })
  );

  scheduleTimers();
  void probeTick();
}

function scheduleTimers() {
  if (localTickTimer) clearInterval(localTickTimer);
  if (probeTimer) clearInterval(probeTimer);

  localTick();

  const cfg = config();
  const localSeconds = Math.max(5, cfg.get<number>("refreshIntervalSeconds", 15));
  localTickTimer = setInterval(localTick, localSeconds * 1000);

  const probeSeconds = Math.max(30, cfg.get<number>("preciseProbeIntervalSeconds", 60));
  probeTimer = setInterval(() => void probeTick(), probeSeconds * 1000);
}

export function deactivate() {
  if (localTickTimer) clearInterval(localTickTimer);
  if (probeTimer) clearInterval(probeTimer);
}
