import { z } from "zod";
import { ToolInputError } from "../client.js";
import { domainArg, tool, type ToolDef } from "./define.js";

export const domainTools: ToolDef[] = [
  // --- account ------------------------------------------------------------------
  tool({
    name: "get_domain_verification_key",
    title: "Get domain verification key",
    toolset: "account",
    operation: "GET /verification-key",
    description:
      "Returns the account's domain verification key and the DNS TXT record that proves ownership of a domain. " +
      "Before create_domain will work, the user must add a TXT record named `<key>.<yourdomain>` with value " +
      "`domain-verified` (the response shows the exact record; this server cannot change DNS) and wait for DNS " +
      "to propagate, typically 5-15 minutes.",
  }),

  // --- domains ------------------------------------------------------------------
  tool({
    name: "list_domains",
    title: "List domains",
    toolset: "domains",
    operation: "GET /domains",
    description: "Lists the names of all domains on the MXroute account.",
  }),
  tool({
    name: "get_domain",
    title: "Get domain details",
    toolset: "domains",
    operation: "GET /domains/{domain}",
    description:
      "Returns details for one domain: whether mail hosting is enabled, whether SSL is enabled, and its domain pointers.",
    input: { domain: domainArg },
  }),
  tool({
    name: "create_domain",
    title: "Add domain",
    toolset: "domains",
    operation: "POST /domains",
    description:
      "Adds a domain to the account. The domain's verification TXT record must already exist in DNS " +
      "(see get_domain_verification_key) or the call will be rejected. Returns 409 if the domain already exists.",
    input: { domain: domainArg.describe("Domain name to add, e.g. example.com") },
  }),
  tool({
    name: "delete_domain",
    title: "Delete domain",
    toolset: "domains",
    operation: "DELETE /domains/{domain}",
    description:
      "Permanently removes a domain from the account (irreversible); mailboxes and forwarders under the domain " +
      "are affected.",
    input: { domain: domainArg },
    doneMessage: (a) => `Domain ${String(a["domain"])} was deleted.`,
  }),
  tool({
    name: "set_mail_hosting_status",
    title: "Enable or disable mail hosting",
    toolset: "domains",
    operation: "PATCH /domains/{domain}/mail-status",
    description:
      "Enables or disables mail hosting for a domain. Disabling stops MXroute from handling mail for the domain. " +
      "Safe to repeat with the same value.",
    input: {
      domain: domainArg,
      enabled: z.boolean().describe("true to enable mail hosting, false to disable it"),
    },
    destructive: true,
    doneMessage: (a) => `Mail hosting for ${String(a["domain"])} is now ${a["enabled"] ? "enabled" : "disabled"}.`,
  }),

  // --- domain pointers ----------------------------------------------------------
  tool({
    name: "list_domain_pointers",
    title: "List domain pointers",
    toolset: "pointers",
    operation: "GET /domains/{domain}/pointers",
    description:
      "Lists the domain pointers (aliases and redirects) that point at a domain. Each entry has the pointer " +
      "domain, its type (alias or redirect) and the target domain.",
    input: { domain: domainArg },
  }),
  tool({
    name: "create_domain_pointer",
    title: "Create domain pointer",
    toolset: "pointers",
    operation: "POST /domains/{domain}/pointers",
    description:
      "Creates a domain pointer so that another domain points at `domain` (the target). alias=true (default) " +
      "creates an alias pointer, alias=false creates a redirect pointer.",
    input: {
      domain: domainArg.describe("The target domain that the pointer will point at"),
      pointer: domainArg.describe("The domain that should point at the target, e.g. alias.com"),
      alias: z
        .boolean()
        .optional()
        .describe("true (default) creates an alias, false creates a redirect"),
    },
    doneMessage: (a) => `Domain pointer ${String(a["pointer"])} -> ${String(a["domain"])} was created.`,
  }),
  tool({
    name: "delete_domain_pointer",
    title: "Delete domain pointer",
    toolset: "pointers",
    operation: "DELETE /domains/{domain}/pointers/{pointer}",
    description: "Removes a domain pointer from a domain.",
    input: {
      domain: domainArg.describe("The target domain the pointer points at"),
      pointer: domainArg.describe("The pointer domain to remove, e.g. alias.com"),
    },
    doneMessage: (a) => `Domain pointer ${String(a["pointer"])} was removed from ${String(a["domain"])}.`,
  }),

  // --- DNS ----------------------------------------------------------------------
  tool({
    name: "get_dns_records",
    title: "Get DNS records for a domain",
    toolset: "dns",
    operation: "GET /domains/{domain}/dns",
    description:
      "Returns the DNS records to configure at the registrar for a domain: MX records, SPF, DKIM (when " +
      "available) and the verification record. Read-only; it does not change DNS.",
    input: { domain: domainArg },
  }),

  // --- catch-all ----------------------------------------------------------------
  tool({
    name: "get_catch_all",
    title: "Get catch-all setting",
    toolset: "catchall",
    operation: "GET /domains/{domain}/catch-all",
    description: "Returns how mail to non-existent addresses on a domain is handled: fail, blackhole or address.",
    input: { domain: domainArg },
  }),
  tool({
    name: "set_catch_all",
    title: "Set catch-all",
    toolset: "catchall",
    operation: "PATCH /domains/{domain}/catch-all",
    description:
      "Sets how mail to non-existent addresses on a domain is handled: type=fail rejects it, type=blackhole " +
      "silently discards it (mail is lost), type=address forwards it to `address`. `address` is required when " +
      "type is address and must be omitted otherwise.",
    input: {
      domain: domainArg,
      type: z.enum(["fail", "blackhole", "address"]).describe("fail = reject, blackhole = silently discard, address = forward"),
      address: z
        .string()
        .regex(/^[^\s@]+@[^\s@]+$/, "Must be an email address")
        .optional()
        .describe("Destination email address; required when type is 'address'"),
    },
    destructive: true,
    validate: (args) => {
      if (args["type"] === "address" && !args["address"]) {
        throw new ToolInputError('`address` is required when type is "address".');
      }
      if (args["type"] !== "address" && args["address"] !== undefined) {
        throw new ToolInputError('`address` can only be set when type is "address".');
      }
    },
    doneMessage: (a) => `Catch-all for ${String(a["domain"])} is now "${String(a["type"])}".`,
  }),
];
