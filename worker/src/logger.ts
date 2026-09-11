/**
 * Structured, timestamped logging.
 *
 * Phase timings are an operational requirement here rather than a convenience: the whole claim
 * about trustless cross-chain state rests on how long finality plus attestation actually takes,
 * and those numbers are quoted in the demo.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold: number = LEVEL_ORDER[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? 20;

function emit(level: LogLevel, scope: string, message: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < threshold) return;
  const parts = [
    new Date().toISOString(),
    level.toUpperCase().padEnd(5),
    `[${scope}]`.padEnd(12),
    message,
  ];
  if (fields && Object.keys(fields).length > 0) {
    parts.push(
      Object.entries(fields)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    );
  }
  // eslint-disable-next-line no-console
  process.stdout.write(parts.join(" ") + "\n");
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, fields?: Record<string, unknown>) =>
      emit("debug", scope, message, fields),
    info: (message: string, fields?: Record<string, unknown>) =>
      emit("info", scope, message, fields),
    warn: (message: string, fields?: Record<string, unknown>) =>
      emit("warn", scope, message, fields),
    error: (message: string, fields?: Record<string, unknown>) =>
      emit("error", scope, message, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;
