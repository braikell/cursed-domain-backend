import type { Context } from "hono";

export function resolveRequestId(context: Context): string {
  const fromHeader = context.req.header("x-request-id")?.trim();
  if (fromHeader) return fromHeader;
  return crypto.randomUUID();
}
