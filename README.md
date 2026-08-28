# Claude Pulse

Extensión de VS Code: indicador en la status bar con el **% exacto** de uso
de la ventana de rate-limit de Claude Code (5h y 7d). El detalle vive en el
**tooltip** (hover sobre el icono) — anclado justo encima de la status bar,
con un pequeño GIF de pulso animado (color según severidad) como detalle
decorativo, no protagonista.

## Por qué no hay flyout ni panel dockeado

Se evaluaron y descartaron dos alternativas antes de llegar aquí:

- **Un flyout flotante anclado a la status bar** (tipo menú de inicio de
  Windows): VS Code no expone ninguna API de extensiones para crear una
  ventana posicionada junto a un elemento arbitrario de la UI. No es una
  limitación de esta extensión, es de la plataforma.
- **QuickPick al hacer click**: sí es "flyout-like" en comportamiento
  (aparece/desaparece con animación nativa, se cierra al clicar fuera), pero
  su posición la fija VS Code — siempre centrado arriba, como el buscador de
  archivos. No se puede anclar a la status bar.
- **Un panel dockeado** (como `vscode-pets`, en el área inferior junto a
  Terminal/Output): posición fija (esa zona), no es un elemento flotante ni
  transitorio — es una pestaña permanente más.

El **tooltip de la status bar** es la única superficie que VS Code sí ancla
justo donde vive el icono. La limitación es que se activa con hover, no con
click, y su contenido es Markdown (sin JS, sin CSS real) — por eso el pulso
es un GIF pre-renderizado en vez de una animación en vivo por código.

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
solo utilización. Y solo se muestra si detecta que usas una API key de pago,
no con suscripción (Pro/Max/Team) — ver "Decisiones de diseño".

## Instalar para desarrollo/test

```bash
npm install
```

Abre esta carpeta en VS Code y pulsa **F5** (`Run Extension`). Se abre una
ventana "Extension Development Host" — pasa el ratón por encima del icono de
Claude Pulse en la status bar (esquina inferior derecha) para ver el
tooltip. Guardar un `.ts` recompila solo (`npm run watch` corre como
pre-launch task); recarga la ventana de dev host con `Cmd/Ctrl+R`.

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
  suscripción, el coste se oculta y se sustituye por el tiempo hasta el
  reset en la status bar; con API key se muestra directo en el tooltip.
- **Pulso como GIF, no animación en vivo**: el tooltip de status bar no es
  un webview — no ejecuta JS ni CSS, solo Markdown. Un `<canvas>`/SVG
  animado no es posible ahí. Se generaron 4 GIFs (uno por severidad,
  `src/pulseAssets.ts`, ~25-30KB c/u en base64) con Pillow: forma de ECG real
  (ondas P/QRS/T vía suma de gaussianas, no un zigzag recto), muestreada a
  alta densidad y con una capa de glow difuminada debajo de una línea fina
  nítida — sin bordes duros ni pixelado. Sí es animación real (30 frames),
  pero no puede reaccionar en vivo al % exacto dentro del propio frame; solo
  se elige qué de las 4 variantes de color mostrar al reconstruir el tooltip.
- **Colores de severidad**: 4 escalones (no continuo) — azul/verde/
  amarillo/naranja según `< 20 / < 40 / < 60 / resto`. Coherente con la
  paleta pedida (azul→verde→amarillo→ámbar→naranja), colapsando ámbar y
  naranja en un único escalón superior. Mismo bucket para el color del icono
  de la status bar (`statusBarItem.color`, `ThemeColor` `charts.*`) y para el
  GIF — un único punto de verdad (`severityBucket()`).
- **Barra con resolución subcaracter**: 8 celdas usando los bloques Unicode
  de octavo (`▏▎▍▌▋▊▉█`) en vez de alternar solo lleno/vacío en 10 celdas —
  se ve más fina/moderna y representa el % con más precisión visual. Celdas
  vacías como `·` (punto) en vez de bloque sombreado, menos "pesado".
