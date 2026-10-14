export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; details?: unknown };

/** Thin fetch wrapper that understands the API's { ok, data | error } envelope. */
export async function apiRequest<T>(url: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => null)) as
      | { ok: true; data: T }
      | { ok: false; error: { code: string; message: string; details?: unknown } }
      | null;
    if (response.ok && json && json.ok) return { ok: true, data: json.data };
    if (json && !json.ok) {
      return { ok: false, code: json.error.code, message: json.error.message, details: json.error.details };
    }
    return { ok: false, code: `HTTP_${response.status}`, message: "" };
  } catch {
    return { ok: false, code: "NETWORK", message: "" };
  }
}

export function errorText(
  result: { code: string; message: string },
  messages: { invalidCredentials: string; tooManyAttempts: string; accountDisabled: string; network: string; unknown: string },
): string {
  switch (result.code) {
    case "INVALID_CREDENTIALS":
      return messages.invalidCredentials;
    case "RATE_LIMITED":
      return messages.tooManyAttempts;
    case "ACCOUNT_DISABLED":
      return messages.accountDisabled;
    case "NETWORK":
      return messages.network;
    default:
      return result.message || messages.unknown;
  }
}
