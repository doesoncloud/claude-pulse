import * as vscode from "vscode";
import { buildStats, loadMessages, Stats } from "./usage";
import { probeExactUsage, detectUsingApiTokens, PreciseUsage } from "./preciseUsage";
import { PulsePanelProvider, PanelData } from "./panel";

let statusBarItem: vscode.StatusBarItem;
let panelProvider: PulsePanelProvider;
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
  // Con suscripción el coste en $ no es información accionable (plan fijo) — se
  // sustituye por el tiempo hasta el próximo reset, que sí lo es siempre.
  const secondary = usingApiTokens ? formatCost(cost5h) : formatCountdown(resetTarget5h());

  let label = "";
  if (displayMode === "percent") label = `${pct.toFixed(0)}%`;
  else if (displayMode === "cost") label = secondary;
  else label = `${pct.toFixed(0)}% · ${secondary}`;

  const icon = exact ? "$(pulse)" : "$(pulse) ~";
  statusBarItem.text = `${icon} ${bar} ${label}`;
  statusBarItem.tooltip = buildTooltip(exact);
  statusBarItem.show();

  panelProvider?.update(buildPanelData(pct, exact));
}

function buildPanelData(pct5h: number, exact: boolean): PanelData {
  const w5h = lastLocalStats?.windows["5h"];
  const w24h = lastLocalStats?.windows["24h"];
  const w7d = lastLocalStats?.windows["7d"];
  return {
    pct5h,
    exact,
    reset5hEpochMs: resetTarget5h()?.getTime() ?? null,
    pct7d: lastPrecise?.sevenDay.utilizationPct ?? null,
    reset7dEpochMs: lastPrecise?.sevenDay.resetAt.getTime() ?? null,
    cost5h: w5h?.cost ?? 0,
    cost24h: w24h?.cost ?? 0,
    cost7d: w7d?.cost ?? 0,
    requests5h: w5h?.requests ?? 0,
    overallStatus: lastPrecise?.overallStatus ?? null,
    probeError: lastProbeError ?? null,
    usingApiTokens,
  };
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

interface DetailItem extends vscode.QuickPickItem {
  action?: "refresh" | "openPanel";
}

const SEP: DetailItem = { label: "", kind: vscode.QuickPickItemKind.Separator };

/** Bucket de color por severidad, usando los theme-color IDs reales de VS Code
 * (no admiten RGB arbitrario) — misma progresión que el degradado del panel,
 * discretizada: azul -> verde -> amarillo -> naranja. */
function severityIcon(pct: number): vscode.ThemeIcon {
  const colorId = pct < 20 ? "charts.blue" : pct < 40 ? "charts.green" : pct < 60 ? "charts.yellow" : "charts.orange";
  return new vscode.ThemeIcon("circle-large-filled", new vscode.ThemeColor(colorId));
}

function showDetails(): void {
  const qp = vscode.window.createQuickPick<DetailItem>();
  qp.title = "$(pulse) Claude Pulse";
  qp.placeholder = "5h/7d exactos vía Anthropic · coste local desde ~/.claude/projects";

  const items: DetailItem[] = [];
  const { pct: pct5h, exact } = currentPct5h();

  items.push(SEP, { label: "Ventana 5h", kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: `${pct5h.toFixed(0)}%`,
    description: exact ? "dato exacto de Anthropic" : "≈ estimado local",
    detail: `reset en ${formatCountdown(resetTarget5h())}`,
    iconPath: severityIcon(pct5h),
  });

  if (lastPrecise) {
    items.push({ label: "Ventana 7d", kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `${lastPrecise.sevenDay.utilizationPct.toFixed(0)}%`,
      description: "dato exacto de Anthropic",
      detail: `reset en ${formatCountdown(lastPrecise.sevenDay.resetAt)}`,
      iconPath: severityIcon(lastPrecise.sevenDay.utilizationPct),
    });
    if (lastPrecise.overallStatus !== "allowed") {
      items.push({
        label: `⚠ Estado: ${lastPrecise.overallStatus}`,
        iconPath: new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.orange")),
      });
    }
  }

  if (lastLocalStats) {
    const w5h = lastLocalStats.windows["5h"];
    items.push({ label: "Actividad", kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: `${w5h.requests} peticiones`, description: "en la ventana de 5h" });

    if (usingApiTokens) {
      const w24h = lastLocalStats.windows["24h"];
      const w7d = lastLocalStats.windows["7d"];
      items.push({ label: "Coste", kind: vscode.QuickPickItemKind.Separator });
      items.push({ label: formatCost(w5h.cost), description: "últimas 5h" });
      items.push({ label: formatCost(w24h.cost), description: "últimas 24h" });
      items.push({ label: formatCost(w7d.cost), description: "últimos 7d" });
      items.push({ label: formatCost(lastLocalStats.allTime.cost), description: "histórico total" });
    } else {
      items.push({
        label: "Plan con suscripción",
        description: "el coste en $ no aplica — plan fijo",
        iconPath: new vscode.ThemeIcon("info"),
      });
    }
  }

  if (lastProbeError) {
    items.push({ label: "Aviso", kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: `⚠ ${lastProbeError}`, description: "usando estimación local mientras tanto" });
  }

  items.push(SEP);
  items.push({ label: "$(refresh) Refrescar ahora", action: "refresh" });
  items.push({ label: "$(layout-panel) Abrir panel con el pulso en vivo", action: "openPanel" });

  qp.items = items;
  qp.onDidAccept(() => {
    const picked = qp.selectedItems[0];
    qp.hide();
    if (picked?.action === "refresh") {
      localTick();
      void probeTick();
    } else if (picked?.action === "openPanel") {
      void vscode.commands.executeCommand(`${PulsePanelProvider.viewId}.focus`);
    }
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "claudePulse.showDetails";
  context.subscriptions.push(statusBarItem);

  panelProvider = new PulsePanelProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PulsePanelProvider.viewId, panelProvider)
  );

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
