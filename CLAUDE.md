# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Extensión de VS Code (TypeScript + esbuild). Barra de estado con el % de uso de la
ventana de rate-limit de 5h de Claude Code + coste estimado, leyendo directamente
`~/.claude/projects/**/*.jsonl` — sin backend propio. Ver `README.md` para instalar/publicar.

Réplica en TypeScript de la lógica de `~/stacks/claude-dash/app/app.py` (dashboard
Flask del homelab) pero client-side y sin dependencia de ese servicio — pensada para
publicarse en el Marketplace, no solo para uso interno.

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
  (`buildStats`). Testeable de forma aislada.
- `src/extension.ts` — capa VS Code: `StatusBarItem`, comandos (`claudePulse.showDetails`,
  `claudePulse.refresh`), lectura de `workspace.getConfiguration`, polling por
  `setInterval` (sin `fs.watch` recursivo, ver README § Decisiones de diseño).

## Convenciones de precios

Los precios en `PRICING` (`src/usage.ts`) son USD/token, derivados de la tabla oficial
de Anthropic (input/output) más la proporción estándar de cache (write ≈1.25x input,
read ≈0.1x input). Al añadir un modelo nuevo, usar la skill `claude-api` de este mismo
repo (`/data/projects/`) para la tarifa vigente — no inventar precios.
