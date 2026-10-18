import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MxrouteError, ToolInputError, type MxrouteClient } from "./client.js";
import { ConfigError, type ServerOptions } from "./config.js";
import { redact } from "./redact.js";
import { runTool, selectTools } from "./tools/index.js";
import { VERSION } from "./version.js";

export interface ServerDeps {
  /**
   * Returns the API client. Called lazily on each tool call so the server can
   * start (and list its tools) without credentials; it throws ConfigError when
   * they are missing.
   */
  getClient: () => MxrouteClient;
  options: ServerOptions;
}

/** Builds the server instructions, mentioning only tools that are actually registered. */
export function buildInstructions(registered: ReadonlySet<string>): string {
  const parts = ["Manages an MXroute email hosting account through the MXroute REST API."];
  if (registered.has("create_domain") && registered.has("get_domain_verification_key")) {
    parts.push(
      "To add a domain: call get_domain_verification_key, ask the user to create the TXT record it describes " +
        "(this server cannot change DNS), wait for DNS to propagate, then create_domain.",
    );
  }
  if (registered.has("get_dns_records")) {
    parts.push("Use get_dns_records to see the MX/SPF/DKIM records a domain needs.");
  }
  if ([...registered].some((n) => n.includes("email_account") || n.includes("forwarder"))) {
    parts.push("Mailbox and forwarder names are the part before the @.");
  }
  parts.push("The API documents no password in any response; passwords you send are not echoed back.");
  parts.push("Tools marked destructive delete data, overwrite passwords or can discard mail or interrupt service: confirm with the user first.");
  return parts.join(" ");
}

function textResult(value: unknown): CallToolResult {
  // Compact JSON: list responses can be long and the reader is a model.
  return { content: [{ type: "text", text: JSON.stringify(redact(value)) }] };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Turns a thrown error into a model-readable tool error without leaking secrets. */
export function describeError(err: unknown): string {
  if (err instanceof MxrouteError) {
    const parts = [`MXroute API error: ${err.message}`];
    const meta: string[] = [];
    if (err.status > 0) meta.push(`HTTP ${err.status}`);
    meta.push(`code ${err.code}`);
    if (err.field) meta.push(`field "${err.field}"`);
    parts.push(`(${meta.join(", ")})`);
    if (err.status === 401) {
      parts.push("Check MXROUTE_SERVER, MXROUTE_USERNAME and MXROUTE_API_KEY.");
    } else if (err.status === 429) {
      const wait = err.retryAfter !== undefined ? ` Retry after ${err.retryAfter} seconds.` : "";
      parts.push(`Rate limit reached.${wait}`);
    }
    return parts.join(" ");
  }
  if (err instanceof ConfigError || err instanceof ToolInputError) return err.message;
  return "Unexpected error while calling the MXroute API.";
}

export function createServer(deps: ServerDeps): McpServer {
  const tools = selectTools(deps.options);
  const server = new McpServer(
    { name: "mxroute", version: VERSION },
    { instructions: buildInstructions(new Set(tools.map((t) => t.name))) },
  );

  for (const def of tools) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        // strict(): a misspelled argument must fail loudly instead of being dropped
        // while the call still "succeeds" with defaults.
        inputSchema: z.object(def.input).strict(),
        annotations: {
          title: def.title,
          readOnlyHint: def.readOnly,
          destructiveHint: def.destructive,
          idempotentHint: def.idempotent,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const client = deps.getClient();
          return textResult(await runTool(def, client, args));
        } catch (err) {
          return errorResult(describeError(err));
        }
      },
    );
  }

  return server;
}
