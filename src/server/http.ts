import { ZodError, type z } from "zod";
import { getEnv } from "./env";
import { logger } from "./logger";

/** Domain error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data }, init);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "ورودی نامعتبر است.",
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  logger.error("api.unhandled_error", { error });
  return Response.json(
    { ok: false, error: { code: "INTERNAL", message: "خطای داخلی سامانه." } },
    { status: 500 },
  );
}

/** Wraps a route handler so every thrown error becomes a consistent JSON response. */
export function apiRoute<C = unknown>(fn: (request: Request, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(request, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function parseJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "درخواست نامعتبر است.");
  }
  return schema.parse(body);
}

/**
 * CSRF defence in depth: session cookies are SameSite=Lax and API bodies must be JSON,
 * and in addition a browser-sent Origin must match the host this request was made to.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, "BAD_ORIGIN", "درخواست از مبدأ مجاز نیست.");
  }
  const allowed = new Set<string>();
  for (const candidate of [request.headers.get("host"), request.headers.get("x-forwarded-host")]) {
    if (candidate) allowed.add(candidate.split(",")[0].trim());
  }
  const base = getEnv().PUBLIC_BASE_URL;
  if (base) allowed.add(new URL(base).host);
  if (!allowed.has(originHost)) {
    throw new AppError(403, "BAD_ORIGIN", "درخواست از مبدأ مجاز نیست.");
  }
}

/**
 * The app listens on 127.0.0.1 only, so the only peer able to set X-Forwarded-For is the
 * local reverse proxy (Plesk Nginx). See docs/plesk-domain-fa.md.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64);
  return (request.headers.get("x-real-ip") ?? "unknown").slice(0, 64);
}

export function getUserAgent(request: Request): string | null {
  return request.headers.get("user-agent")?.slice(0, 500) ?? null;
}
