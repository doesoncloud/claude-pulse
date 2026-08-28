import * as vscode from "vscode";

export interface PanelData {
  pct5h: number;
  exact: boolean;
  reset5hEpochMs: number | null;
  pct7d: number | null;
  reset7dEpochMs: number | null;
  cost5h: number;
  cost24h: number;
  cost7d: number;
  requests5h: number;
  overallStatus: string | null;
  probeError: string | null;
}

function nonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export class PulsePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "claudePulse.panel";
  private view: vscode.WebviewView | undefined;
  private latest: PanelData | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    if (this.latest) {
      void webviewView.webview.postMessage(this.latest);
    }
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  update(data: PanelData): void {
    this.latest = data;
    if (this.view) {
      void this.view.webview.postMessage(data);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce()}';`;
    const scriptNonce = csp.match(/'nonce-([^']+)'/)![1];

    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 10px 12px;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-panel-background, transparent);
    display: flex; flex-direction: column; gap: 6px;
    min-height: 100vh; box-sizing: border-box;
  }
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .title { font-weight: 600; opacity: 0.85; font-size: 0.9em; letter-spacing: 0.03em; }
  .pct { font-size: 1.4em; font-weight: 700; }
  .ecg-wrap { flex: 1; min-height: 46px; display: flex; align-items: center; }
  svg { width: 100%; height: 46px; overflow: visible; }
  .ecg-line {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 220;
    stroke-dashoffset: 0;
    animation: sweep linear infinite;
  }
  @keyframes sweep {
    from { stroke-dashoffset: 220; }
    to { stroke-dashoffset: 0; }
  }
  .ok { stroke: var(--vscode-charts-green, #4caf50); }
  .warn { stroke: var(--vscode-charts-yellow, #d29922); }
  .danger { stroke: var(--vscode-charts-red, #f14c4c); }
  .meta { font-size: 0.85em; opacity: 0.75; display: flex; flex-direction: column; gap: 2px; }
  .approx::after { content: " (≈ estimado)"; opacity: 0.7; font-style: italic; }
  .error { color: var(--vscode-errorForeground); font-size: 0.8em; }
</style>
</head>
<body>
  <div class="head">
    <span class="title">CLAUDE PULSE</span>
    <span class="pct" id="pct">--%</span>
  </div>
  <div class="ecg-wrap">
    <svg viewBox="0 0 220 46" preserveAspectRatio="none">
      <path id="ecgPath" class="ecg-line ok"
        d="M0 23 L30 23 L38 8 L46 38 L54 23 L80 23 L88 4 L96 42 L104 23 L220 23" />
    </svg>
  </div>
  <div class="meta">
    <span id="window5h">Ventana 5h: --</span>
    <span id="reset5h">Reset en: --</span>
    <span id="window7d">Ventana 7d: --</span>
    <span id="cost">Coste 5h: -- · 24h: -- · 7d: --</span>
    <span id="err" class="error"></span>
  </div>
<script nonce="${scriptNonce}">
  const pctEl = document.getElementById('pct');
  const ecg = document.getElementById('ecgPath');
  const w5hEl = document.getElementById('window5h');
  const reset5hEl = document.getElementById('reset5h');
  const w7dEl = document.getElementById('window7d');
  const costEl = document.getElementById('cost');
  const errEl = document.getElementById('err');

  let reset5hEpoch = null;
  let reset7dEpoch = null;

  function fmtCountdown(epochMs) {
    if (!epochMs) return '--';
    const secs = Math.floor((epochMs - Date.now()) / 1000);
    if (secs <= 0) return 'reseteando...';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h + 'h ' + m + 'm';
  }

  function severityClass(pct) {
    if (pct >= 85) return 'danger';
    if (pct >= 60) return 'warn';
    return 'ok';
  }

  function applyData(data) {
    const pct = Math.round(data.pct5h);
    pctEl.textContent = pct + '%';
    ecg.classList.remove('ok', 'warn', 'danger');
    ecg.classList.add(severityClass(pct));
    // Más uso = latido más rápido: 2.6s a 0%, ~0.5s a 100%.
    const duration = Math.max(0.5, 2.6 - (pct / 100) * 2.1);
    ecg.style.animationDuration = duration.toFixed(2) + 's';

    w5hEl.textContent = 'Ventana 5h: ' + pct + '%' + (data.exact ? '' : ' (≈ estimado)') + ' · ' + data.requests5h + ' peticiones';
    reset5hEpoch = data.reset5hEpochMs;
    reset7dEpoch = data.reset7dEpochMs;
    w7dEl.textContent = data.pct7d != null ? ('Ventana 7d: ' + Math.round(data.pct7d) + '%') : 'Ventana 7d: --';
    costEl.textContent = 'Coste 5h: $' + data.cost5h.toFixed(2) + ' · 24h: $' + data.cost24h.toFixed(2) + ' · 7d: $' + data.cost7d.toFixed(2);
    errEl.textContent = data.probeError ? ('⚠ ' + data.probeError) : '';
  }

  window.addEventListener('message', (event) => applyData(event.data));

  setInterval(() => {
    reset5hEl.textContent = 'Reset en: ' + fmtCountdown(reset5hEpoch);
  }, 1000);
</script>
</body>
</html>`;
  }
}
