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
  usingApiTokens: boolean;
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
    transition: stroke 0.6s ease;
  }
  @keyframes sweep {
    from { stroke-dashoffset: 220; }
    to { stroke-dashoffset: 0; }
  }
  .reset {
    font-size: 1em;
    font-weight: 600;
  }
  .meta { font-size: 0.85em; opacity: 0.75; display: flex; flex-direction: column; gap: 2px; }
  .toggle {
    cursor: pointer; user-select: none; opacity: 0.65; font-size: 0.8em;
    display: inline-flex; align-items: center; gap: 4px; width: fit-content;
  }
  .toggle:hover { opacity: 1; }
  .cost-block { display: none; flex-direction: column; gap: 2px; }
  .cost-block.open { display: flex; }
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
      <path id="ecgPath" class="ecg-line"
        d="M0 23 L30 23 L38 8 L46 38 L54 23 L80 23 L88 4 L96 42 L104 23 L220 23" />
    </svg>
  </div>
  <div class="meta">
    <span class="reset" id="reset5h">Reset en: --</span>
    <span id="window7d">Ventana 7d: --</span>
    <span class="toggle" id="costToggle">▸ coste</span>
    <div class="cost-block" id="costBlock">
      <span id="cost">5h: -- · 24h: -- · 7d: --</span>
      <span id="reqs">-- peticiones en la ventana de 5h</span>
    </div>
    <span id="err" class="error"></span>
  </div>
<script nonce="${scriptNonce}">
  const pctEl = document.getElementById('pct');
  const ecg = document.getElementById('ecgPath');
  const reset5hEl = document.getElementById('reset5h');
  const w7dEl = document.getElementById('window7d');
  const costEl = document.getElementById('cost');
  const reqsEl = document.getElementById('reqs');
  const costBlock = document.getElementById('costBlock');
  const costToggle = document.getElementById('costToggle');
  const errEl = document.getElementById('err');

  let reset5hEpoch = null;
  let costOpen = false;

  costToggle.addEventListener('click', () => {
    costOpen = !costOpen;
    costBlock.classList.toggle('open', costOpen);
    costToggle.textContent = (costOpen ? '▾' : '▸') + ' coste';
  });

  function fmtCountdown(epochMs) {
    if (!epochMs) return '--';
    const secs = Math.floor((epochMs - Date.now()) / 1000);
    if (secs <= 0) return 'reseteando...';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h + 'h ' + m + 'm';
  }

  // Degradado continuo: 0%=azul, 25%=verde, 50%=amarillo, 75%=ámbar, 100%=naranja (tono Claude).
  const STOPS = [
    [0,   [59, 130, 246]],
    [25,  [34, 197, 94]],
    [50,  [234, 179, 8]],
    [75,  [245, 158, 11]],
    [100, [249, 115, 22]],
  ];
  function gradientColor(pct) {
    const p = Math.max(0, Math.min(100, pct));
    let lo = STOPS[0], hi = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (p >= STOPS[i][0] && p <= STOPS[i + 1][0]) { lo = STOPS[i]; hi = STOPS[i + 1]; break; }
    }
    const span = hi[0] - lo[0];
    const t = span === 0 ? 0 : (p - lo[0]) / span;
    const rgb = lo[1].map((c, i) => Math.round(c + (hi[1][i] - c) * t));
    return 'rgb(' + rgb.join(',') + ')';
  }

  function applyData(data) {
    const pct = Math.round(data.pct5h);
    pctEl.textContent = pct + '%' + (data.exact ? '' : ' ≈');

    const color = gradientColor(pct);
    ecg.style.stroke = color;
    // Más uso = latido más rápido: 2.6s a 0%, ~0.5s a 100%.
    const duration = Math.max(0.5, 2.6 - (pct / 100) * 2.1);
    ecg.style.animationDuration = duration.toFixed(2) + 's';

    reset5hEpoch = data.reset5hEpochMs;
    w7dEl.textContent = data.pct7d != null ? ('Ventana 7d: ' + Math.round(data.pct7d) + '%') : 'Ventana 7d: --';

    costEl.textContent = '5h: $' + data.cost5h.toFixed(2) + ' · 24h: $' + data.cost24h.toFixed(2) + ' · 7d: $' + data.cost7d.toFixed(2);
    reqsEl.textContent = data.requests5h + ' peticiones en la ventana de 5h';

    // Con API key de pago el coste es información accionable -> visible sin plegar.
    // Con suscripción (Pro/Max/Team) el coste no es lo que importa -> plegado por defecto.
    costToggle.style.display = data.usingApiTokens ? 'none' : '';
    if (data.usingApiTokens) {
      costBlock.classList.add('open');
    }

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
