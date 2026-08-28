import * as vscode from "vscode";
import { buildStats, loadMessages, Stats } from "./usage";

let statusBarItem: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let lastStats: Stats | undefined;

const BAR_SEGMENTS = 10;

function renderBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * BAR_SEGMENTS);
  return "█".repeat(filled) + "░".repeat(BAR_SEGMENTS - filled);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatCountdown(secs: number | null): string {
  if (secs === null) return "sin actividad reciente";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function config() {
  return vscode.workspace.getConfiguration("claudePulse");
}

function refresh() {
  const cfg = config();
  const tokenLimit5h = cfg.get<number>("tokenLimit5h", 88000);
  const displayMode = cfg.get<string>("displayMode", "both");
  const projectsDir = cfg.get<string>("projectsDir", "");

  let stats: Stats;
  try {
    const messages = loadMessages(projectsDir || undefined);
    stats = buildStats(messages, tokenLimit5h);
  } catch (err) {
    statusBarItem.text = "$(pulse) Claude Pulse: error";
    statusBarItem.tooltip = `No se pudieron leer las sesiones de Claude Code: ${err}`;
    return;
  }
  lastStats = stats;

  const bar = renderBar(stats.pct5h);
  const w5h = stats.windows["5h"];

  let label = "";
  if (displayMode === "percent") label = `${stats.pct5h}%`;
  else if (displayMode === "cost") label = formatCost(w5h.cost);
  else label = `${stats.pct5h}% · ${formatCost(w5h.cost)}`;

  statusBarItem.text = `$(pulse) ${bar} ${label}`;
  statusBarItem.tooltip = buildTooltip(stats);
  statusBarItem.show();
}

function buildTooltip(stats: Stats): vscode.MarkdownString {
  const w5h = stats.windows["5h"];
  const w24h = stats.windows["24h"];
  const w7d = stats.windows["7d"];

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Claude Pulse**\n\n`);
  md.appendMarkdown(`Ventana 5h (rate-limit): **${stats.pct5h}%** de ${stats.tokenLimit5h.toLocaleString()} tok salida\n\n`);
  md.appendMarkdown(`- Coste: ${formatCost(w5h.cost)} · ${w5h.requests} peticiones\n`);
  md.appendMarkdown(`- Reset en: ${formatCountdown(stats.secsToReset)}\n\n`);
  md.appendMarkdown(`**24h**: ${formatCost(w24h.cost)} · ${w24h.requests} peticiones\n\n`);
  md.appendMarkdown(`**7d**: ${formatCost(w7d.cost)} · ${w7d.requests} peticiones\n\n`);
  md.appendMarkdown(`_Click para ver el detalle completo._`);
  return md;
}

async function showDetails() {
  if (!lastStats) {
    refresh();
  }
  if (!lastStats) {
    vscode.window.showWarningMessage("Claude Pulse: no hay datos de uso todavía.");
    return;
  }
  const s = lastStats;
  const w5h = s.windows["5h"];
  const w24h = s.windows["24h"];
  const w7d = s.windows["7d"];

  const lines = [
    `Ventana 5h: ${s.pct5h}% · ${formatCost(w5h.cost)} · ${w5h.requests} peticiones · reset en ${formatCountdown(s.secsToReset)}`,
    `24h: ${formatCost(w24h.cost)} · ${w24h.requests} peticiones · ${w24h.totalTokens.toLocaleString()} tokens`,
    `7d: ${formatCost(w7d.cost)} · ${w7d.requests} peticiones · ${w7d.totalTokens.toLocaleString()} tokens`,
    `Total histórico: ${formatCost(s.allTime.cost)} · ${s.allTime.requests} peticiones`,
  ];

  const pick = await vscode.window.showQuickPick(lines, {
    title: "Claude Pulse — Detalle de uso",
    placeHolder: "Datos leídos de ~/.claude/projects/**/*.jsonl",
  });
  void pick;
}

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "claudePulse.showDetails";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(vscode.commands.registerCommand("claudePulse.showDetails", showDetails));
  context.subscriptions.push(vscode.commands.registerCommand("claudePulse.refresh", refresh));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("claudePulse")) {
        scheduleRefresh();
      }
    })
  );

  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refresh();
  const seconds = config().get<number>("refreshIntervalSeconds", 15);
  refreshTimer = setInterval(refresh, Math.max(5, seconds) * 1000);
}

export function deactivate() {
  if (refreshTimer) clearInterval(refreshTimer);
}
