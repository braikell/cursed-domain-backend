import type { BackendModuleName, ErrorEnvelope } from "./contracts.js";

export class HttpModuleError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly module: BackendModuleName,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function buildErrorEnvelope(
  error: unknown,
  module: BackendModuleName,
  requestId?: string,
): { status: number; body: ErrorEnvelope } {
  if (error instanceof HttpModuleError) {
    return {
      status: error.status,
      body: {
        ok: false,
        code: error.code,
        message: error.message,
        details: error.details,
        request_id: requestId,
        module,
      },
    };
  }

  const message = error instanceof Error ? error.message : "Unknown backend error.";
  return {
    status: 500,
    body: {
      ok: false,
      code: "internal_error",
      message,
      request_id: requestId,
      module,
    },
  };
}
