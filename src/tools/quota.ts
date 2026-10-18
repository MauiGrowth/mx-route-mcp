import { tool, type ToolDef } from "./define.js";

export const quotaTools: ToolDef[] = [
  tool({
    name: "get_quota",
    title: "Get disk usage and quota",
    toolset: "quota",
    operation: "GET /quota",
    description:
      "Returns the account's overall disk usage: bytes used, quota limit in bytes (0 = unlimited), percent used, " +
      "a breakdown by category (email, web, databases, backups, other) and grace-period status if over quota. " +
      "Figures are refreshed hourly by MXroute.",
  }),
  tool({
    name: "get_email_usage",
    title: "Get per-mailbox disk usage",
    toolset: "quota",
    operation: "GET /quota/email",
    description:
      "Returns disk usage in bytes for every mailbox on the account, largest first. Refreshed hourly by MXroute.",
  }),
];
