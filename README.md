# Claude Pulse

Extensión de VS Code: indicador en la status bar con el **% exacto** de uso
de la ventana de rate-limit de Claude Code (5h y 7d) — click abre un detalle
enriquecido (QuickPick con secciones/iconos por severidad). Además, un panel
opcional (dock en el área inferior junto a Terminal/Output, estilo
`vscode-pets`) con una línea de pulso animada en vivo para quien quiera
dejarlo fijo.

**Sobre el "flyout anclado a la status bar"**: se evaluó y descartó — VS Code
no expone a las extensiones ninguna API para crear una ventana flotante
posicionada junto a un elemento arbitrario (tipo menú de inicio de Windows).
Los primitivos reales son QuickPick (transient, animación nativa, pero
posición fija centrada arriba — la que usamos para el detalle), el tooltip de
status bar (sí anclado, pero solo con hover, no click) y las vistas dockeadas
(el panel). Documentado por si se reabre la decisión más adelante.

La línea del panel late más rápido y su color interpola por un degradado
continuo de 5 paradas (azul → verde → amarillo → ámbar → naranja) según el %
de la ventana de 5h.

## Cómo consigue el % exacto (no una estimación)

Cada respuesta autenticada de la API de Anthropic incluye cabeceras
`anthropic-ratelimit-unified-5h-utilization` / `-7d-utilization` — el mismo
dato que usa el `/usage` interno de Claude Code, calculado por el servidor de
Anthropic, no derivado de contar tokens localmente.

La extensión lanza periódicamente `claude -p "1" --no-session-persistence`
(el modelo más barato, `--no-session-persistence` para no dejar rastro en tu
historial de sesiones — verificado: 0 ficheros `.jsonl` nuevos) con
`ANTHROPIC_LOG=debug`, y lee esas cabeceras de la salida de depuración.
Coste real por sondeo: ~$0.0002 (unos pocos tokens de salida + lectura de
caché). Por defecto cada 60s, configurable (`preciseProbeIntervalSeconds`,
mínimo 30s).

Si el probe falla (sin `claude` en PATH, sin red, CLI desactualizado) la
extensión cae a una **estimación local** (suma de tokens de salida en
`~/.claude/projects/**/*.jsonl` sobre un límite configurable) y lo marca
explícitamente en el tooltip — nunca presenta una estimación como si fuera
el dato exacto.

El coste en $ (5h/24h/7d) sí sigue siendo estimado localmente vía tabla de
precios embebida — Anthropic no devuelve un coste en $ en las cabeceras,
solo utilización.

## Instalar para desarrollo/test

```bash
npm install
```

Abre esta carpeta en VS Code y pulsa **F5** (`Run Extension`). Se abre una ventana
"Extension Development Host" con la extensión activa — el panel "Claude Pulse"
aparece como pestaña junto a Terminal/Output/Problems (área inferior por
defecto), y el resumen compacto en la status bar. Arrástralo a un lateral o al
Explorer si prefieres esa ubicación — es la ubicación estándar de VS Code, se
recuerda entre sesiones igual que cualquier otro panel. Guardar un `.ts`
recompila solo (`npm run watch` corre como pre-launch task); recarga la
ventana de dev host con `Cmd/Ctrl+R`.

Para probarla como instalación real (persiste al cerrar VS Code):

```bash
npm run package              # genera claude-pulse-0.0.1.vsix
code --install-extension claude-pulse-0.0.1.vsix
```

### Node 18

`@vscode/vsce` reciente arrastra `undici`, que en Node 20+ usa el global `File`
(Web API) — en Node 18 no existe como global y `vsce package` revienta con
`ReferenceError: File is not defined`. `npm run package` ya incluye el
workaround (`scripts/node18-file-shim.js`, vía `node -r`) — usa ese script, no
`npx vsce package` directo, mientras el host siga en Node 18.

## Configuración

| Setting | Default | Qué hace |
|---|---|---|
| `claudePulse.preciseMode` | `true` | Sondea el % exacto a Anthropic. Desactivar = solo estimación local, sin ejecutar `claude`. |
| `claudePulse.preciseProbeIntervalSeconds` | `60` | Cada cuánto se sondea el % exacto (mínimo 30s). |
| `claudePulse.claudeBinaryPath` | `""` | Ruta al binario `claude` si no está en el PATH de VS Code. |
| `claudePulse.tokenLimit5h` | `88000` | Solo fallback si `preciseMode` está off o el probe falla. |
| `claudePulse.refreshIntervalSeconds` | `15` | Cada cuánto se releen los `.jsonl` locales para coste/24h/7d (no afecta al % exacto). |
| `claudePulse.displayMode` | `both` | `percent` \| `cost` \| `both` en el texto de la barra. |
| `claudePulse.projectsDir` | `""` (autodetecta) | Override de `~/.claude/projects`. |

## Publicar

**VS Code Marketplace**: crear publisher en https://marketplace.visualstudio.com/manage
(requiere una org de Azure DevOps, gratis) → generar un Personal Access Token con
scope "Marketplace (Manage)" → `vsce login <publisher>` → `vsce publish`.
Cambiar `publisher` en `package.json` de `CHANGEME` al id real antes de publicar.

**Open VSX** (VSCodium y otros forks): cuenta en Eclipse Foundation → token →
`npx ovsx publish -p <token>`.

## Decisiones de diseño

- **Fuente de verdad del %**: cabeceras `anthropic-ratelimit-unified-*` reales
  de la API, vía un probe periódico a `claude -p`. No se intenta extraer o
  reimplementar el token OAuth de Claude Code — se reutiliza el CLI ya
  autenticado, más lento (~1-2s por sondeo) pero sin tocar credenciales.
- **Fragilidad conocida**: `ANTHROPIC_LOG=debug` es un log de depuración
  interno de la SDK, no una API estable — el formato podría cambiar entre
  versiones de `claude`. Si el parseo deja de encontrar las cabeceras, cae
  automáticamente a estimación local en vez de romperse (ver `preciseUsage.ts`).
- **Coste del propio probe**: cada sondeo es una petición real mínima
  (modelo Haiku, prompt de 1 token, cache de sistema caliente) — negligible
  pero no cero, y técnicamente cuenta contra la misma ventana que mide. Por
  eso el intervalo mínimo es 30s, no continuo.
- Datos de coste (5h/24h/7d en $) siguen viniendo de parsear
  `~/.claude/projects/**/*.jsonl` localmente — global (todas las sesiones del
  host), no solo del workspace actual, porque la ventana de rate-limit es de
  cuenta, no por proyecto.
- **Coste solo si es accionable**: `detectUsingApiTokens()` (`claude auth
  status` → `authMethod`) distingue suscripción (Pro/Max/Team, coste en $ no
  aplica — plan fijo) de API key de pago (coste sí es dinero real). Con
  suscripción, el coste se oculta de la status bar/panel y se sustituye por
  el tiempo hasta el reset; sigue accesible en el detalle (QuickPick) y
  plegado en el panel.
- **Colores de severidad**: el panel usa un degradado RGB continuo (CSS, sin
  restricción). El QuickPick, al ser UI nativa, solo admite `ThemeColor` de
  la paleta registrada de VS Code (`charts.blue/green/yellow/orange`) — se
  discretiza a 4 escalones en vez de interpolar, es una limitación de esa API,
  no una elección de diseño.
