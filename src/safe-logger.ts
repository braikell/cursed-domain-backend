import { env } from "./env.js";

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel = LOG_LEVELS[env.GODOT_BACKEND_LOG_LEVEL];

const PII_KEYS = new Set([
  "userid",
  "user_id",
  "email",
  "accesstoken",
  "access_token",
  "password",
  "pass",
  "pwd",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "token",
  "refreshtoken",
  "refresh_token",
  "supabasekey",
  "supabase_key",
  "service_role_key",
  "credit_card",
  "phone",
  "ssn",
  "passport",
  "address",
]);

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevel;
}

function sanitize(value: unknown, depth: number = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitize(val, depth + 1);
      }
    }
    return result;
  }

  return value;
}

function sanitizeString(value: string): string {
  if (value.length > 500) return value.slice(0, 500) + "...";
  return value;
}

function format(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (meta !== undefined) {
    const safe = sanitize(meta);
    if (typeof safe === "object" && safe !== null) {
      console.log(`${prefix} ${message}`, safe);
    } else {
      console.log(`${prefix} ${message} ${safe}`);
    }
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export const logger = {
  debug(message: string, meta?: unknown) {
    if (shouldLog("debug")) format("debug", message, meta);
  },

  info(message: string, meta?: unknown) {
    if (shouldLog("info")) format("info", message, meta);
  },

  warn(message: string, meta?: unknown) {
    if (shouldLog("warn")) format("warn", message, meta);
  },

  error(message: string, meta?: unknown) {
    if (shouldLog("error")) format("error", message, meta);
  },
};
