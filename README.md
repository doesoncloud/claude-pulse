# Claude Pulse

**Un indicador en tiempo real, en la propia status bar de VS Code, del % exacto
que llevas consumido de tu ventana de uso de Claude Code — con el dato real
que usa Anthropic, no una estimación.**

Si usas Claude Code a diario, seguramente ya conoces la sorpresa de que te
corte a mitad de tarea porque has agotado la ventana de 5 horas sin enterarte.
Claude Pulse pone ese dato a la vista, todo el tiempo, sin salir del editor.

![Ejemplo del pulso en naranja, cerca del límite](docs/media/pulse-orange.gif)

## Qué hace

- Un icono en la status bar (esquina inferior derecha) con una **barra de
  progreso** y el **% de la ventana de rate-limit de 5 horas**.
- El icono y la barra **cambian de color** según cuánto llevas consumido —
  de un vistazo, sin tener que leer el número.
- Al pasar el ratón por encima, un **tooltip enriquecido** con el detalle: %
  de la ventana de 5h y de 7 días, cuenta atrás hasta el próximo reset,
  peticiones realizadas, y coste en $ (si aplica — ver más abajo).
- Cero telemetría, cero red salvo la propia consulta a Anthropic para leer tu
  dato de uso real. Todo lo demás se calcula localmente.

## El dato es exacto, no una estimación

Esto es lo que diferencia a Claude Pulse: **no cuenta tokens para adivinar un
porcentaje**. Anthropic no publica en ningún sitio el límite exacto de la
ventana de 5 horas — cualquier extensión que intente calcularlo a partir de
tokens está adivinando.

En su lugar, Claude Pulse pregunta directamente a Anthropic: cada respuesta
autenticada de la API incluye cabeceras (`anthropic-ratelimit-unified-5h-utilization`,
`-7d-utilization`) con el **porcentaje real, calculado por el servidor** — el
mismo dato que usa el comando `/usage` de Claude Code. Claude Pulse lanza
periódicamente una consulta mínima (`claude -p "1" --no-session-persistence`,
sin dejar rastro en tu historial de sesiones, coste real ≈$0.0002 por
consulta) y lee esas cabeceras. Por defecto cada 60 segundos.

Si esa consulta falla (sin conexión, CLI desactualizado), Claude Pulse cae a
una estimación local a partir de tus sesiones — y te lo dice explícitamente
en el tooltip (nunca presenta una estimación como si fuera el dato exacto).

## Gama de colores

| Color | Rango | Qué significa |
|---|:---:|---|
| 🔵 Azul | 0–19% | Apenas has empezado la ventana. Tranquilo. |
| 🟢 Verde | 20–39% | Uso normal, sin nada de qué preocuparte. |
| 🟡 Amarillo | 40–59% | Vas por la mitad — vale la pena vigilar el ritmo si te queda tarea larga por delante. |
| 🟠 Naranja | 60–100% | Te acercas al límite. Si el reset está lejos, es buen momento para planificar una pausa. |

### Ejemplos

| | | |
|:---:|:---:|:---:|
| ![Azul](docs/media/pulse-blue.gif) | ![Verde](docs/media/pulse-green.gif) | ![Amarillo](docs/media/pulse-yellow.gif) |
| **12%** · tranquilo | **34%** · uso normal | **52%** · uso moderado |

| |
|:---:|
| ![Naranja](docs/media/pulse-orange.gif) |
| **88%** · cerca del límite |

Así se ve en la status bar (texto ilustrativo, la barra usa bloques Unicode de
resolución subcaracter — más precisa que un simple lleno/vacío):

```
🔵  ▍·······   12% · 4h 48m restantes
🟢  ▉▉▍·····   34% · 3h 12m restantes
🟡  ▉▉▉▉▍···   52% · 2h 20m restantes
🟠  ▉▉▉▉▉▉▉▍   88% · 41m restantes
```

## Coste en $ — solo cuando importa

Si usas **Claude Code con suscripción** (Pro/Max/Team), el coste en dólares no
es información accionable: pagas un plan fijo, no por token. En ese caso
Claude Pulse lo oculta de la vista principal y muestra en su lugar el tiempo
restante hasta el próximo reset — el dato que sí puedes usar para planificar.

Si en cambio usas una **API key de pago por token**, el coste sí es dinero
real — Claude Pulse lo detecta automáticamente (`claude auth status`) y lo
muestra en el tooltip: gasto de las últimas 5h, 24h, 7 días e histórico,
calculado a partir de tus sesiones locales y la tabla de precios oficial de
Anthropic.

## Instalación

Todavía no está publicada en el Marketplace (llegará en una versión
posterior). Mientras tanto, instálala desde el `.vsix`:

```bash
git clone https://github.com/doesoncloud/claude-pulse.git
cd claude-pulse
npm install
npm run package                      # genera claude-pulse-<versión>.vsix
code --install-extension claude-pulse-<versión>.vsix
```

Recarga VS Code (`Developer: Reload Window`) y busca el icono en la esquina
inferior derecha de la status bar.

## Configuración

| Setting | Default | Qué hace |
|---|---|---|
| `claudePulse.preciseMode` | `true` | Sondea el % exacto a Anthropic. Desactivar = solo estimación local, sin ejecutar `claude`. |
| `claudePulse.preciseProbeIntervalSeconds` | `60` | Cada cuánto se sondea el % exacto (mínimo 30s). |
| `claudePulse.claudeBinaryPath` | `""` | Ruta al binario `claude` si no está en el PATH de VS Code. |
| `claudePulse.tokenLimit5h` | `88000` | Solo fallback si `preciseMode` está off o el probe falla. |
| `claudePulse.refreshIntervalSeconds` | `15` | Cada cuánto se releen los datos locales de sesión (coste/tokens 24h-7d). |
| `claudePulse.displayMode` | `both` | `percent` \| `cost` \| `both` en el texto de la barra. |
| `claudePulse.projectsDir` | `""` (autodetecta) | Override de `~/.claude/projects`. |

## Requisitos

- VS Code 1.85 o superior.
- [Claude Code](https://code.claude.com) instalado y autenticado (`claude auth login`) — Claude Pulse lo usa como fuente del dato exacto, no incluye su propia autenticación.

## Desarrollo

```bash
npm install
npm run watch     # esbuild en modo watch
npm run check     # chequeo de tipos (tsc --noEmit)
npm run package   # genera el .vsix (incluye workaround para Node 18, ver abajo)
```

Pulsa **F5** en VS Code para abrir un "Extension Development Host" con la
extensión cargada en caliente.

Detalles de arquitectura, decisiones de diseño y por qué ciertas superficies
de UI (un panel dockeado, un flyout flotante) se evaluaron y descartaron:
ver [`CLAUDE.md`](CLAUDE.md).

### Nota: Node 18

`@vscode/vsce` reciente arrastra `undici`, que en Node 20+ usa el global
`File` — en Node 18 no existe y `vsce package` falla con
`ReferenceError: File is not defined`. `npm run package` ya incluye el
workaround (`scripts/node18-file-shim.js`).

## Cómo consigue el dato exacto (detalle técnico)

Cada respuesta autenticada de `/v1/messages` incluye, entre sus cabeceras
HTTP, el estado de la ventana de rate-limit de la cuenta — no del modelo, de
la cuenta:

```
anthropic-ratelimit-unified-5h-utilization: 0.37
anthropic-ratelimit-unified-5h-reset: 1787928000
anthropic-ratelimit-unified-7d-utilization: 0.18
anthropic-ratelimit-unified-7d-reset: 1788375600
```

Claude Pulse no reimplementa el cliente OAuth de Claude Code para leer estas
cabeceras directamente (sería frágil y tocaría credenciales que no le
corresponden) — en su lugar, ejecuta periódicamente el propio `claude` CLI ya
autenticado en tu máquina con `ANTHROPIC_LOG=debug` y `--no-session-persistence`,
y parsea la cabecera de su salida de depuración. Es más lento (~1-2s por
sondeo) que una llamada HTTP directa, pero no requiere gestionar tokens.

## Licencia

MIT
