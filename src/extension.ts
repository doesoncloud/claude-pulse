import * as vscode from "vscode";
import { buildStats, loadMessages, Stats } from "./usage";
import { probeExactUsage, detectUsingApiTokens, PreciseUsage } from "./preciseUsage";
import { PULSE_GIF_BASE64 } from "./pulseAssets";

let statusBarItem: vscode.StatusBarItem;
let localTickTimer: NodeJS.Timeout | undefined;
let probeTimer: NodeJS.Timeout | undefined;
let probeInFlight = false;

let lastLocalStats: Stats | undefined;
let lastPrecise: PreciseUsage | undefined;
let lastProbeError: string | undefined;
let usingApiTokens = false;

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

/** % a mostrar: exacto de Anthropic si el probe funcionó, si no, estimación local. */
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

/** Mismos 4 escalones de color que la severidad del panel, aplicados al GIF embebido. */
function severityColorName(pct: number): keyof typeof PULSE_GIF_BASE64 {
  if (pct < 20) return "blue";
  if (pct < 40) return "green";
  if (pct < 60) return "yellow";
  return "orange";
}

function render() {
  const cfg = config();
  const displayMode = cfg.get<string>("displayMode", "both");
  const { pct, exact } = currentPct5h();
  const bar = renderBar(pct);
  const cost5h = lastLocalStats?.windows["5h"].cost ?? 0;
  // Con suscripción el coste en $ no es información accionable (plan fijo) — se
  // sustituye por el tiempo hasta el próximo reset, que sí lo es siempre.
  const secondary = usingApiTokens ? formatCost(cost5h) : formatCountdown(resetTarget5h());

  let label = "";
  if (displayMode === "percent") label = `${pct.toFixed(0)}%`;
  else if (displayMode === "cost") label = secondary;
  else label = `${pct.toFixed(0)}% · ${secondary}`;

  const icon = exact ? "$(pulse)" : "$(pulse) ~";
  statusBarItem.text = `${icon} ${bar} ${label}`;
  statusBarItem.tooltip = buildTooltip(pct, exact);
  statusBarItem.show();
}

function buildTooltip(pct5h: number, exact: boolean): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  const gif = PULSE_GIF_BASE64[severityColorName(pct5h)];

  md.appendMarkdown(`### Claude Pulse\n\n`);
  md.appendMarkdown(`![pulso](data:image/gif;base64,${gif})\n\n`);
  md.appendMarkdown(`**${pct5h.toFixed(0)}%** de la ventana de 5h`);
  md.appendMarkdown(exact ? ` · dato exacto de Anthropic\n\n` : ` · ≈ estimado local\n\n`);
  md.appendMarkdown(`⏱ Reset en **${formatCountdown(resetTarget5h())}**\n\n`);

  if (lastPrecise) {
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(
      `**${lastPrecise.sevenDay.utilizationPct.toFixed(0)}%** de la ventana de 7 días · reset en ${formatCountdown(lastPrecise.sevenDay.resetAt)}\n\n`
    );
    if (lastPrecise.overallStatus !== "allowed") {
      md.appendMarkdown(`⚠️ Estado de la cuenta: **${lastPrecise.overallStatus}**\n\n`);
    }
  }

  if (lastLocalStats) {
    const w5h = lastLocalStats.windows["5h"];
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`${w5h.requests} peticiones en esta ventana de 5h\n\n`);

    if (usingApiTokens) {
      const w24h = lastLocalStats.windows["24h"];
      const w7d = lastLocalStats.windows["7d"];
      md.appendMarkdown(
        `💰 5h: ${formatCost(w5h.cost)} · 24h: ${formatCost(w24h.cost)} · 7d: ${formatCost(w7d.cost)} · histórico: ${formatCost(lastLocalStats.allTime.cost)}\n\n`
      );
    }
  }

  if (lastProbeError) {
    md.appendMarkdown(`---\n\n⚠ ${lastProbeError} — usando estimación local mientras tanto\n\n`);
  }

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

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  // El detalle vive en el tooltip (hover) — es la posición anclada real que se
  // puede conseguir junto a la status bar. El click dispara un refresco manual.
  statusBarItem.command = "claudePulse.refresh";
  context.subscriptions.push(statusBarItem);

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

  const claudeBinary = config().get<string>("claudeBinaryPath", "") || "claude";
  void detectUsingApiTokens(claudeBinary).then((v) => {
    usingApiTokens = v;
    render();
  });
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
