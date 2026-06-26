import type { Context } from "hono";

import type { BackendModuleName, GodotAuthedRequestContext } from "./contracts.js";
import { HttpModuleError } from "./errors.js";
import { createAuthSupabaseClient } from "./supabase.js";

export async function requireAuthedGodotUser(
  context: Context,
  module: BackendModuleName,
): Promise<GodotAuthedRequestContext> {
  const accessToken = await readGodotAccessToken(context.req.raw, module);
  const supabase = createAuthSupabaseClient();
  const authResult = await (supabase.auth as {
    getUser: (jwt: string) => Promise<{
      data: { user: { id: string } | null };
      error: { message?: string } | null;
    }>;
  }).getUser(accessToken);
  const user = authResult.data.user;

  if (authResult.error != null || user == null) {
    throw new HttpModuleError(401, "unauthorized", module, "Unauthorized");
  }

  return {
    accessToken,
    userId: user.id,
  };
}

async function readGodotAccessToken(request: Request, module: BackendModuleName): Promise<string> {
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }

  if (request.method.toUpperCase() === "GET") {
    const url = new URL(request.url);
    const token = url.searchParams.get("accessToken")?.trim() ?? "";
    if (token.length > 0) return token;
  }

  const body = await request.clone().json().catch(() => null);
  if (body != null && typeof body === "object" && "accessToken" in body) {
    const token = String((body as Record<string, unknown>).accessToken ?? "").trim();
    if (token.length > 0) return token;
  }

  throw new HttpModuleError(400, "invalid_access_token_payload", module, "Invalid access token payload.");
}
