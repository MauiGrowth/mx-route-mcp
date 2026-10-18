import { z, type ZodRawShape } from "zod";
import { buildPath, type HttpMethod, type MxrouteClient } from "../client.js";

/** Groups of tools that can be switched on or off with MXROUTE_TOOLSETS. */
export const TOOLSETS = [
  "account",
  "domains",
  "pointers",
  "mailboxes",
  "forwarders",
  "spam",
  "dns",
  "catchall",
  "quota",
  "reseller_users",
  "reseller_packages",
] as const;
export type Toolset = (typeof TOOLSETS)[number];

export type Args = Record<string, unknown>;

export interface ToolDef {
  /** snake_case tool name exposed over MCP. */
  name: string;
  title: string;
  /** Written for the model: what it does, side effects, prerequisites. */
  description: string;
  toolset: Toolset;
  /** `METHOD /path/{param}` as in the MXroute OpenAPI document. */
  operation: string;
  /** Zod raw shape for the tool's arguments. */
  input: ZodRawShape;
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  /** Extra validation that a flat zod shape can't express. Throw ToolInputError. */
  validate?: (args: Args) => void;
  /** Overrides the default body (every argument that is not a path parameter). */
  buildBody?: (args: Args) => Record<string, unknown>;
  /** Message returned when the API answers with no content (204). */
  doneMessage?: (args: Args) => string;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  toolset: Toolset;
  operation: `${HttpMethod} /${string}`;
  input?: ZodRawShape;
  /** Overrides the method-derived default (DELETE and a few PATCH/POST calls). */
  destructive?: boolean;
  /** Overrides the method-derived default. */
  idempotent?: boolean;
  validate?: ToolDef["validate"];
  buildBody?: ToolDef["buildBody"];
  doneMessage?: ToolDef["doneMessage"];
}

export const DESTRUCTIVE_NOTE = "Destructive: confirm with the user before calling.";

export function methodOf(operation: string): HttpMethod {
  return operation.split(" ")[0] as HttpMethod;
}

export function pathOf(operation: string): string {
  return operation.slice(operation.indexOf(" ") + 1);
}

/**
 * Builds a tool definition. MCP behaviour hints are derived from the HTTP
 * method (GET = read-only, DELETE = destructive) unless explicitly overridden;
 * every call talks to an external service, so openWorldHint is always true.
 */
export function tool(spec: ToolSpec): ToolDef {
  const method = methodOf(spec.operation);
  const readOnly = method === "GET";
  const destructive = readOnly ? false : (spec.destructive ?? method === "DELETE");
  const def: ToolDef = {
    name: spec.name,
    title: spec.title,
    // Models (and clients that drop server instructions) see the cue on every destructive tool.
    description: destructive ? `${spec.description} ${DESTRUCTIVE_NOTE}` : spec.description,
    toolset: spec.toolset,
    operation: spec.operation,
    input: spec.input ?? {},
    readOnly,
    destructive,
    idempotent: spec.idempotent ?? (method !== "POST"),
  };
  if (spec.validate) def.validate = spec.validate;
  if (spec.buildBody) def.buildBody = spec.buildBody;
  if (spec.doneMessage) def.doneMessage = spec.doneMessage;
  return def;
}

/** Runs one tool call against the API and returns a JSON-serialisable result. */
export async function runTool(def: ToolDef, client: MxrouteClient, args: Args): Promise<unknown> {
  def.validate?.(args);

  const method = methodOf(def.operation);
  const template = pathOf(def.operation);
  const pathParams = new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string));
  const path = buildPath(template, args);

  let body: Record<string, unknown> | undefined;
  if (method === "POST" || method === "PATCH") {
    if (def.buildBody) {
      body = def.buildBody(args);
    } else {
      body = {};
      for (const [key, value] of Object.entries(args)) {
        if (!pathParams.has(key) && value !== undefined) body[key] = value;
      }
    }
  }

  // Action endpoints such as POST .../suspend define no request body: send none.
  if (body && Object.keys(body).length === 0) body = undefined;

  const data = await client.request(method, path, { body });
  if (data === null || data === undefined) {
    const fallback = method === "GET" ? "The API returned no data." : "Done.";
    return { ok: true, message: def.doneMessage?.(args) ?? fallback };
  }
  return data;
}

// --- shared argument fragments ------------------------------------------------

/** A bare domain name: models often pass URLs or addresses, which would otherwise reach the API as-is. */
const bareName = (what: string) =>
  z
    .string()
    .min(1)
    .regex(/^[^\s/@\\:]+$/, `Give just the ${what}, e.g. example.com (no spaces, @, / or :)`);

export const domainArg = bareName("domain name").describe("Domain name on the MXroute account, e.g. example.com");

/** A count limit: a whole number or the string "unlimited". */
export const countOrUnlimited = (description: string) =>
  z.union([z.number().int().min(0), z.string().regex(/^(unlimited|\d+)$/)]).describe(description);

/** A size limit that may be fractional: a number or the string "unlimited". */
export const sizeOrUnlimited = (description: string) =>
  z.union([z.number().min(0), z.string().regex(/^(unlimited|\d+(\.\d+)?)$/)]).describe(description);

/** Converts a number|"unlimited" argument to the string form the API expects. */
export function limitToString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return String(value);
}
