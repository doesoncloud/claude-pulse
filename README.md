# Claude Pulse

Extensión de VS Code: barra de estado en tiempo real con el % de uso de la ventana
de rate-limit de 5h de Claude Code, coste estimado y totales de 24h/7d.

Lee directamente `~/.claude/projects/**/*.jsonl` (los transcripts locales que ya
escribe Claude Code) — sin backend, sin red, sin telemetría.

## Instalar para desarrollo/test

```bash
npm install
```

Abre esta carpeta en VS Code y pulsa **F5** (`Run Extension`). Se abre una ventana
"Extension Development Host" con la extensión activa — la barrita aparece a la
derecha de la status bar. Guardar un `.ts` recompila solo (`npm run watch` corre
como pre-launch task); recarga la ventana de dev host con `Cmd/Ctrl+R`.

Para probarla como instalación real (persiste al cerrar VS Code):

```bash
npm install -g @vscode/vsce
npm run build
vsce package                 # genera claude-pulse-0.0.1.vsix
code --install-extension claude-pulse-0.0.1.vsix
```

## Configuración

| Setting | Default | Qué hace |
|---|---|---|
| `claudePulse.tokenLimit5h` | `88000` | Tokens de salida = 100% de la ventana de 5h. Anthropic no publica el número exacto — ajustar según tu plan. |
| `claudePulse.refreshIntervalSeconds` | `15` | Cada cuánto se releen los `.jsonl`. |
| `claudePulse.displayMode` | `both` | `percent` \| `cost` \| `both` en el texto de la barra. |
| `claudePulse.projectsDir` | `""` (autodetecta `~/.claude/projects`) | Override si tu instalación de Claude Code usa otra ruta. |

## Publicar

**VS Code Marketplace**: crear publisher en https://marketplace.visualstudio.com/manage
(requiere una org de Azure DevOps, gratis) → generar un Personal Access Token con
scope "Marketplace (Manage)" → `vsce login <publisher>` → `vsce publish`.
Cambiar `publisher` en `package.json` de `CHANGEME` al id real antes de publicar.

**Open VSX** (VSCodium y otros forks): cuenta en Eclipse Foundation → token →
`npx ovsx publish -p <token>`.

## Decisiones de diseño (MVP)

- Los datos son **globales** (todas las sesiones del host), no solo del workspace
  actual: la ventana de 5h de Claude Code es una cuenta atrás de toda la cuenta,
  no por proyecto — filtrar por workspace daría un % engañoso.
- Sin `fs.watch` recursivo (poco fiable entre SO) — polling simple cada
  `refreshIntervalSeconds`. Vía de mejora futura si hace falta más tiempo real.
- Tabla de precios embebida (`src/usage.ts`) — no hay endpoint público de precios,
  hay que actualizarla a mano cuando Anthropic cambie tarifas o lancen modelo nuevo.
