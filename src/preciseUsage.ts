import { execFile } from "node:child_process";

export interface PreciseWindow {
  utilizationPct: number; // 0-100, tal cual lo calcula Anthropic (no una estimación local)
  resetAt: Date;
  status: string; // "allowed" | "rejected" | ...
}

export interface PreciseUsage {
  fiveHour: PreciseWindow;
  sevenDay: PreciseWindow;
  overallStatus: string;
  probedAt: Date;
}

export type ProbeResult = { ok: true; usage: PreciseUsage } | { ok: false; reason: string };

/**
 * Detecta si la sesión usa una suscripción (Pro/Max/Team, vía `claude.ai` OAuth
 * — coste en $ no tiene sentido, se paga a plan fijo) o una API key de pago
 * por token (donde el coste en $ sí es información accionable).
 * Best-effort: si `claude auth status` falla o no es JSON, asume suscripción
 * (comportamiento más conservador: oculta el coste en vez de mostrar uno
 * potencialmente irrelevante).
 */
export function detectUsingApiTokens(claudeBinary: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(claudeBinary, ["auth", "status"], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed.authMethod !== "claude.ai");
      } catch {
        resolve(false);
      }
    });
  });
}

const PROBE_TIMEOUT_MS = 20_000;
const PROBE_MODEL = "claude-haiku-4-5-20251001"; // el más barato — el probe solo lee cabeceras, la respuesta no importa

function extractHeaderNumber(text: string, header: string): number | null {
  const re = new RegExp(`"${header}":\\s*"([\\d.]+)"`);
  let match: RegExpExecArray | null;
  let last: string | null = null;
  const global = new RegExp(re.source, "g");
  while ((match = global.exec(text)) !== null) {
    last = match[1];
  }
  return last === null ? null : Number(last);
}

function extractHeaderString(text: string, header: string): string | null {
  const global = new RegExp(`"${header}":\\s*"([^"]+)"`, "g");
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = global.exec(text)) !== null) {
    last = match[1];
  }
  return last;
}

/**
 * Lanza `claude -p` con ANTHROPIC_LOG=debug y lee del propio log de depuración
 * las cabeceras `anthropic-ratelimit-unified-*` que Anthropic devuelve en toda
 * respuesta autenticada de /v1/messages. Es el mismo dato que usa el `/usage`
 * interno de Claude Code — no una estimación derivada de tokens.
 *
 * `--no-session-persistence` evita que el probe deje transcripts en
 * ~/.claude/projects/ (verificado: 0 ficheros nuevos tras el probe).
 *
 * Nota de fragilidad: el formato de `ANTHROPIC_LOG=debug` es un log de
 * depuración interno, no una API estable — puede cambiar de formato entre
 * versiones de `claude`. Si deja de parsear, la extensión cae automáticamente
 * al modo estimado (ver usage.ts) en vez de romperse.
 */
export function probeExactUsage(claudeBinary: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      claudeBinary,
      ["-p", "1", "--model", PROBE_MODEL, "--no-session-persistence"],
      {
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ANTHROPIC_LOG: "debug" },
      },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ ok: false, reason: `"${claudeBinary}" no encontrado en PATH` });
          return;
        }
        const text = `${stdout}\n${stderr}`;

        const pct5h = extractHeaderNumber(text, "anthropic-ratelimit-unified-5h-utilization");
        const reset5h = extractHeaderNumber(text, "anthropic-ratelimit-unified-5h-reset");
        const status5h = extractHeaderString(text, "anthropic-ratelimit-unified-5h-status");
        const pct7d = extractHeaderNumber(text, "anthropic-ratelimit-unified-7d-utilization");
        const reset7d = extractHeaderNumber(text, "anthropic-ratelimit-unified-7d-reset");
        const status7d = extractHeaderString(text, "anthropic-ratelimit-unified-7d-status");
        const overallStatus = extractHeaderString(text, "anthropic-ratelimit-unified-status");

        if (pct5h === null || reset5h === null || pct7d === null || reset7d === null) {
          resolve({
            ok: false,
            reason: error
              ? `claude -p falló: ${error.message}`
              : "no se encontraron las cabeceras anthropic-ratelimit-unified-* en la salida",
          });
          return;
        }

        resolve({
          ok: true,
          usage: {
            fiveHour: { utilizationPct: pct5h * 100, resetAt: new Date(reset5h * 1000), status: status5h ?? "unknown" },
            sevenDay: { utilizationPct: pct7d * 100, resetAt: new Date(reset7d * 1000), status: status7d ?? "unknown" },
            overallStatus: overallStatus ?? "unknown",
            probedAt: new Date(),
          },
        });
      }
    );
  });
}
