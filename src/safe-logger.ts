import { env } from "./env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function levelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[env.GODOT_BACKEND_LOG_LEVEL];
}

const PII_FIELDS = new Set([
  "userId",
  "user_id",
  "accessToken",
  "access_token",
  "email",
  "display_name",
  "displayName",
]);

function sanitize(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      if (PII_FIELDS.has(key)) {
        clean[key] = "[REDACTED]";
      } else {
        clean[key] = sanitize(val);
      }
    }
    return clean;
  }
  return value;
}

function formatContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return "";
  try {
    return " " + JSON.stringify(sanitize(context));
  } catch {
    return " [unserializable]";
  }
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (!levelEnabled("debug")) return;
    console.debug(`[debug] ${message}${formatContext(context)}`);
  },
  info(message: string, context?: Record<string, unknown>): void {
    if (!levelEnabled("info")) return;
    console.info(`[info] ${message}${formatContext(context)}`);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    if (!levelEnabled("warn")) return;
    console.warn(`[warn] ${message}${formatContext(context)}`);
  },
  error(message: string, context?: Record<string, unknown>): void {
    console.error(`[error] ${message}${formatContext(context)}`);
  },
};
