# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Extensión de VS Code (TypeScript + esbuild). Indicador en la status bar con
el **% exacto** de uso de la ventana de rate-limit de Claude Code — el
detalle vive en el **tooltip** (hover, anclado a la status bar; es la única
posición real que VS Code deja anclar ahí, ver README § "Por qué no hay
flyout/panel"), con un GIF pequeño de pulso animado embebido (color según
severidad) como detalle decorativo, no protagonista. Ver `README.md` §
"Cómo consigue el % exacto" para el mecanismo completo — resumen: sondea
`claude -p --no-session-persistence` con `ANTHROPIC_LOG=debug` y parsea las
cabeceras reales `anthropic-ratelimit-unified-*` de la respuesta de
Anthropic (no una estimación por tokens). El coste en $ sí sigue siendo
estimado localmente desde `~/.claude/projects/**/*.jsonl`, y solo se muestra
si la sesión usa API key de pago (no con suscripción, donde no aplica).

El coste ($) reutiliza la misma lógica que `~/stacks/claude-dash/app/app.py`
(dashboard Flask del homelab) pero portada a TypeScript client-side, sin
dependencia de ese servicio — pensada para publicarse en el Marketplace.

## Comandos

```bash
npm install
npm run watch     # esbuild en modo watch (usado por F5 / Run Extension)
npm run build     # build de producción (minificado)
npm run check     # tsc --noEmit, chequeo de tipos
npm run package   # vsce package -> genera el .vsix
```

Test manual: F5 en VS Code abre el Extension Development Host con la extensión cargada.

## Arquitectura

- `src/usage.ts` — capa pura sin dependencia de `vscode`: lee los `.jsonl`, calcula
  coste por modelo (`PRICING`, tabla embebida) y agrega en ventanas 5h/24h/7d
  (`buildStats`). Fuente del **coste** ($), no del %. Testeable de forma aislada.
- `src/preciseUsage.ts` — capa pura sin dependencia de `vscode`: `probeExactUsage()`
  lanza `claude -p` y parsea las cabeceras `anthropic-ratelimit-unified-*` del log
  de depuración. Fuente del **% exacto**. Testeable de forma aislada (`execFile`
  mockeable).
- `src/pulseAssets.ts` — 4 GIFs de pulso (azul/verde/amarillo/naranja, ~20KB
  cada uno) generados con Pillow y embebidos en base64. Estático, no hay
  script de build automático — regenerar a mano si cambia el diseño (ver
  comentario en el propio fichero).
- `src/extension.ts` — capa VS Code: `StatusBarItem` (texto + `tooltip`
  `MarkdownString` como única vista de detalle — sin QuickPick, sin webview),
  comando `claudePulse.refresh` (click en la barra = refresco manual), dos
  timers independientes (`localTick` cada `refreshIntervalSeconds` para
  coste/tokens, `probeTick` cada `preciseProbeIntervalSeconds` para el %
  exacto) — desacoplados a propósito: el % exacto es caro de refrescar
  (llamada real), el coste local es gratis.

## Convenciones de precios

Los precios en `PRICING` (`src/usage.ts`) son USD/token, derivados de la tabla oficial
de Anthropic (input/output) más la proporción estándar de cache (write ≈1.25x input,
read ≈0.1x input). Al añadir un modelo nuevo, usar la skill `claude-api` de este mismo
repo (`/data/projects/`) para la tarifa vigente — no inventar precios.
