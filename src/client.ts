import type { Config } from "./config.js";
import { VERSION } from "./version.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiErrorDetails {
  status: number;
  code: string;
  field?: string;
  /** Seconds, from the Retry-After header on 429 responses. */
  retryAfter?: number;
  /** Unix timestamp, from X-RateLimit-Reset when present. */
  rateLimitReset?: number;
}

/** Any failure talking to the MXroute API. Messages never contain credentials. */
export class MxrouteError extends Error {
  override name = "MxrouteError";
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;
  readonly retryAfter: number | undefined;
  readonly rateLimitReset: number | undefined;

  constructor(message: string, details: ApiErrorDetails) {
    super(message);
    this.status = details.status;
    this.code = details.code;
    this.field = details.field;
    this.retryAfter = details.retryAfter;
    this.rateLimitReset = details.rateLimitReset;
  }
}

/** Raised for bad tool arguments detected before any request is sent. */
export class ToolInputError extends Error {
  override name = "ToolInputError";
}

/**
 * Substitutes `{name}` placeholders in a path template with URL-encoded values.
 *
 * Every value is run through encodeURIComponent so entries such as
 * `*@trusted.com` cannot break out of their path segment. `.` and `..` are
 * rejected because encodeURIComponent leaves them intact and URL normalisation
 * would turn them into path traversal (e.g. `/domains/../reseller/users`).
 */
export function buildPath(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new ToolInputError(`Missing required path parameter "${name}".`);
    }
    if (value === "." || value === ".." || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new ToolInputError(`Invalid value for "${name}".`);
    }
    try {
      return encodeURIComponent(value);
    } catch {
      // e.g. a lone UTF-16 surrogate, which cannot be encoded
      throw new ToolInputError(`Invalid characters in "${name}".`);
    }
  });
}

/** Keeps API-supplied text short and single-line before it reaches the model or a log. */
export function sanitizeMessage(text: string, max = 500): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function parseNumberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

/** Retry-After is either whole seconds or an HTTP date. */
function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("Retry-After")?.trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/[a-z]/i.test(raw)) return undefined; // an HTTP date names a weekday and month; "-5" is junk
  const when = Date.parse(raw);
  return Number.isNaN(when) ? undefined : Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface RequestOptions {
  body?: Record<string, unknown> | undefined;
}

export class MxrouteClient {
  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /**
   * Performs one API call and returns the unwrapped payload:
   *  - 204 / empty body            -> null
   *  - `{success, data}` envelope  -> `data`
   *  - anything else (e.g. /quota) -> the body as-is
   * Throws {@link MxrouteError} for HTTP, API and network failures.
   */
  async request(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<unknown> {
    const url = this.config.baseUrl + path;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `mx-route-mcp/${VERSION}`,
      "X-Server": this.config.server,
      "X-Username": this.config.username,
      "X-API-Key": this.config.apiKey,
    };
    const init: RequestInit = {
      method,
      headers,
      // Never follow redirects: custom auth headers would be forwarded to the new host.
      redirect: "manual",
      signal: AbortSignal.timeout(this.config.timeoutMs),
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, init);
    } catch (err) {
      throw this.networkError(err, method);
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw this.networkError(err, method);
    }

    let body: unknown;
    let parsedOk = false;
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text);
        parsedOk = true;
      } catch {
        parsedOk = false;
      }
    }

    const rateLimit = {
      retryAfter: parseRetryAfter(res.headers),
      rateLimitReset: parseNumberHeader(res.headers, "X-RateLimit-Reset"),
    };

    if (res.status >= 300 && res.status < 400) {
      throw new MxrouteError(
        `Unexpected redirect (HTTP ${res.status}) from the MXroute API. Check MXROUTE_API_URL.`,
        { status: res.status, code: "REDIRECT", ...rateLimit },
      );
    }

    if (!res.ok) {
      throw this.apiError(res.status, res.statusText, parsedOk ? body : undefined, rateLimit);
    }

    if (res.status === 204 || text.trim().length === 0) return null;

    if (!parsedOk) {
      throw new MxrouteError(
        `The MXroute API returned a non-JSON response (HTTP ${res.status}). Check MXROUTE_API_URL.`,
        { status: res.status, code: "INVALID_RESPONSE" },
      );
    }

    if (isRecord(body) && body["success"] === false) {
      throw this.apiError(res.status, res.statusText, body, rateLimit);
    }
    if (isRecord(body) && body["success"] === true) {
      if ("data" in body) return body["data"];
      const { success: _success, ...rest } = body;
      return Object.keys(rest).length > 0 ? rest : null;
    }
    return body;
  }

  private apiError(
    status: number,
    statusText: string,
    body: unknown,
    rateLimit: { retryAfter: number | undefined; rateLimitReset: number | undefined },
  ): MxrouteError {
    let code = `HTTP_${status}`;
    let message = `${status} ${statusText}`.trim();
    let field: string | undefined;

    if (isRecord(body) && isRecord(body["error"])) {
      const err = body["error"];
      if (typeof err["code"] === "string") code = err["code"];
      if (typeof err["message"] === "string") message = err["message"];
      if (typeof err["field"] === "string") field = sanitizeMessage(err["field"], 80);
    } else if (isRecord(body) && typeof body["message"] === "string") {
      message = body["message"];
    }

    return new MxrouteError(sanitizeMessage(message), {
      status,
      code: sanitizeMessage(code, 80),
      ...(field !== undefined ? { field } : {}),
      ...rateLimit,
    } as ApiErrorDetails);
  }

  private networkError(err: unknown, method: HttpMethod): MxrouteError {
    // For anything but a read the request may have been processed even though no
    // response arrived, and a blind retry could apply it twice.
    const unknownOutcome =
      method === "GET" ? "" : " The change may or may not have been applied: check the current state before retrying.";
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return new MxrouteError(`The MXroute API did not respond within ${this.config.timeoutMs} ms.${unknownOutcome}`, {
        status: 0,
        code: "TIMEOUT",
      });
    }
    const cause = err instanceof Error ? (err as Error & { cause?: { code?: unknown } }).cause : undefined;
    const causeCode = cause && typeof cause.code === "string" ? ` (${cause.code})` : "";
    return new MxrouteError(`Could not reach the MXroute API${causeCode}.${unknownOutcome}`, {
      status: 0,
      code: "NETWORK_ERROR",
    });
  }
}
