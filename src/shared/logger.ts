import { getConfig } from "./config.ts";

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logger.
 *
 * The pipeline is multi-process (scrapers, analysis, scoring) so each log line
 * carries a `context` object (source name, image id, job id, ...) that makes
 * distributed debugging possible without any external tooling.
 */
class Logger {
  private readonly level: number;

  constructor(level: Level = "info") {
    this.level = LEVELS[level];
  }

  log(level: Level, message: string, context?: Record<string, unknown>): void {
    if (LEVELS[level] < this.level) return;
    const line = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ?? {}),
    };
    const out = level === "error" ? process.stderr : process.stdout;
    out.write(`${JSON.stringify(line)}\n`);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }
}

let sharedLogger: Logger | null = null;

/** Process-wide logger configured from the environment. */
export function getLogger(): Logger {
  if (!sharedLogger) {
    sharedLogger = new Logger(getConfig().LOG_LEVEL);
  }
  return sharedLogger;
}

/** Fresh logger (used by tests). */
export function createLogger(level: Level = "info"): Logger {
  return new Logger(level);
}

export type { Level };