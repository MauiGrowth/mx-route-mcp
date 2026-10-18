import type { ServerOptions } from "../config.js";
import { domainTools } from "./domains.js";
import { mailboxTools } from "./mailboxes.js";
import { quotaTools } from "./quota.js";
import { resellerTools } from "./reseller.js";
import { spamTools } from "./spam.js";
import type { ToolDef } from "./define.js";

/** Every tool the server can expose, one per MXroute API operation. */
export const ALL_TOOLS: readonly ToolDef[] = [
  ...domainTools,
  ...mailboxTools,
  ...spamTools,
  ...quotaTools,
  ...resellerTools,
];

/** The tools to register for the given options (read-only mode, toolset filter). */
export function selectTools(options: ServerOptions): ToolDef[] {
  return ALL_TOOLS.filter((t) => options.toolsets.has(t.toolset) && (!options.readOnly || t.readOnly));
}

export { runTool, TOOLSETS, type ToolDef, type Toolset } from "./define.js";
