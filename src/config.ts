import { TOOLSETS, type Toolset } from "./tools/define.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface Config {
  /** Mail server hostname, e.g. `eagle.mxlogin.com` (sent as X-Server). */
  server: string;
  /** DirectAdmin username, or `reseller|user` to act as an owned user (X-Username). */
  username: string;
  /** Complete API key password (X-API-Key). Never logged. */
  apiKey: string;
  /** API origin. Defaults to https://api.mxroute.com. */
  baseUrl: string;
  timeoutMs: number;
}

export interface ServerOptions {
  /** When true, only read-only tools are registered. */
  readOnly: boolean;
  /** Which toolsets to register. */
  toolsets: ReadonlySet<Toolset>;
}

type Env = Record<string, string | undefined>;

const DEFAULT_BASE_URL = "https://api.mxroute.com";
const DEFAULT_TIMEOUT_MS = 30_000;

// HTTP header values must be printable ASCII: anything else (control characters,
// non-Latin-1 text pasted from a document) would make fetch fail with a
// misleading "could not reach the API" error.
const NOT_HEADER_SAFE = /[^\x21-\x7e]/; // also excludes spaces: none of these values may contain one

/** Strict boolean: a typo must not silently turn a safety switch off. */
function parseBool(name: string, value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  if (v === undefined || v === "" || /^(0|false|no|off)$/.test(v)) return false;
  if (/^(1|true|yes|on)$/.test(v)) return true;
  throw new ConfigError(`${name} must be one of true, false, 1, 0, yes, no, on, off (got an unrecognised value).`);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * Reads credentials from the environment. Throws {@link ConfigError} with an
 * actionable message; the message never contains the API key.
 */
export function loadConfig(env: Env = process.env): Config {
  const missing: string[] = [];
  const get = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? "";
  };

  let server = get("MXROUTE_SERVER");
  const username = get("MXROUTE_USERNAME");
  const apiKey = get("MXROUTE_API_KEY");

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        "Set MXROUTE_SERVER (e.g. eagle.mxlogin.com), MXROUTE_USERNAME (your DirectAdmin username) and " +
        "MXROUTE_API_KEY (create one at https://panel.mxroute.com/api-keys.php).",
    );
  }

  // Be forgiving if the server was pasted as a URL.
  server = server.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!server || /[\s/]/.test(server)) {
    throw new ConfigError("MXROUTE_SERVER must be a bare hostname such as eagle.mxlogin.com.");
  }
  if (NOT_HEADER_SAFE.test(server) || NOT_HEADER_SAFE.test(username) || NOT_HEADER_SAFE.test(apiKey)) {
    throw new ConfigError(
      "MXROUTE_SERVER, MXROUTE_USERNAME and MXROUTE_API_KEY must contain only printable ASCII characters " +
        "(no spaces, control or non-ASCII characters). Check for a stray character when copying the value.",
    );
  }

  const rawBase = (env["MXROUTE_API_URL"]?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(rawBase);
  } catch {
    throw new ConfigError("MXROUTE_API_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) {
    throw new ConfigError("MXROUTE_API_URL must use https (plain http is only allowed for localhost testing).");
  }
  if (parsed.username || parsed.password) {
    throw new ConfigError("MXROUTE_API_URL must not embed credentials.");
  }
  if (parsed.search || parsed.hash) {
    throw new ConfigError("MXROUTE_API_URL must not contain a query string or fragment.");
  }

  const timeoutRaw = env["MXROUTE_TIMEOUT_MS"]?.trim();
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const n = Number(timeoutRaw);
    if (!Number.isInteger(n) || n < 1000 || n > 300_000) {
      throw new ConfigError("MXROUTE_TIMEOUT_MS must be an integer between 1000 and 300000.");
    }
    timeoutMs = n;
  }

  return { server, username, apiKey, baseUrl: rawBase, timeoutMs };
}

/** Reads tool-selection options. Unlike credentials these are validated at startup. */
export function loadOptions(env: Env = process.env): ServerOptions {
  const readOnly = parseBool("MXROUTE_READ_ONLY", env["MXROUTE_READ_ONLY"]);

  const raw = env["MXROUTE_TOOLSETS"]?.trim();
  let toolsets: Set<Toolset>;
  if (!raw || raw.toLowerCase() === "all") {
    toolsets = new Set(TOOLSETS);
  } else {
    toolsets = new Set();
    const unknown: string[] = [];
    for (const part of raw.split(",")) {
      const name = part.trim().toLowerCase();
      if (!name) continue;
      if ((TOOLSETS as readonly string[]).includes(name)) toolsets.add(name as Toolset);
      else unknown.push(name);
    }
    if (unknown.length > 0) {
      throw new ConfigError(
        `Unknown MXROUTE_TOOLSETS value(s): ${unknown.join(", ")}. Valid toolsets: ${TOOLSETS.join(", ")} (or "all").`,
      );
    }
    if (toolsets.size === 0) {
      throw new ConfigError(`MXROUTE_TOOLSETS is empty. Valid toolsets: ${TOOLSETS.join(", ")} (or "all").`);
    }
  }

  return { readOnly, toolsets };
}
