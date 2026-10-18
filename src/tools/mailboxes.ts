import { z } from "zod";
import { ToolInputError } from "../client.js";
import { domainArg, tool, type ToolDef } from "./define.js";

const localPart = (what: string) =>
  z
    .string()
    .min(1)
    .regex(/^[^@\s/]+$/, "Give only the part before the @, without the domain")
    .describe(`${what} (the part before the @, without the domain)`);

const password = z
  .string()
  .min(8)
  .max(72)
  .describe("8-72 characters; must also satisfy the mail server's character and strength rules");

export const mailboxTools: ToolDef[] = [
  // --- email accounts -----------------------------------------------------------
  tool({
    name: "list_email_accounts",
    title: "List email accounts",
    toolset: "mailboxes",
    operation: "GET /domains/{domain}/email-accounts",
    description:
      "Lists the mailboxes on a domain with quota (MB, 0 = unlimited), current usage (MB), daily send limit, " +
      "emails sent today and suspended state.",
    input: { domain: domainArg },
  }),
  tool({
    name: "get_email_account",
    title: "Get email account",
    toolset: "mailboxes",
    operation: "GET /domains/{domain}/email-accounts/{username}",
    description: "Returns quota, usage, daily send limit, emails sent today and suspended state for one mailbox.",
    input: { domain: domainArg, username: localPart("Mailbox name") },
  }),
  tool({
    name: "create_email_account",
    title: "Create email account",
    toolset: "mailboxes",
    operation: "POST /domains/{domain}/email-accounts",
    description:
      "Creates a mailbox such as `username@domain`. The password is sent to MXroute and never shown in the result. " +
      "Defaults when omitted: 1024 MB quota, 9600 emails/day send limit.",
    input: {
      domain: domainArg,
      username: localPart("Mailbox name to create"),
      password,
      quota: z.number().int().min(0).optional().describe("Storage quota in MB; 0 means unlimited (API default 1024)"),
      limit: z
        .number()
        .int()
        .min(0)
        .max(9600)
        .optional()
        .describe("Daily send limit, maximum 9600 (API default 9600)"),
    },
    doneMessage: (a) => `Email account ${String(a["username"])}@${String(a["domain"])} was created.`,
  }),
  tool({
    name: "update_email_account",
    title: "Update email account",
    toolset: "mailboxes",
    operation: "PATCH /domains/{domain}/email-accounts/{username}",
    description:
      "Changes a mailbox's password, quota or daily send limit. Provide at least one of password, quota, limit; " +
      "omitted fields stay unchanged. Changing the password locks out anyone using the old one.",
    input: {
      domain: domainArg,
      username: localPart("Existing mailbox name"),
      password: password.optional().describe("New password, 8-72 characters; omit to keep the current one"),
      quota: z.number().int().min(0).optional().describe("New storage quota in MB"),
      limit: z.number().int().min(0).optional().describe("New daily send limit"),
    },
    destructive: true,
    validate: (args) => {
      if (args["password"] === undefined && args["quota"] === undefined && args["limit"] === undefined) {
        throw new ToolInputError("Provide at least one of password, quota or limit to update.");
      }
    },
    doneMessage: (a) => `Email account ${String(a["username"])}@${String(a["domain"])} was updated.`,
  }),
  tool({
    name: "delete_email_account",
    title: "Delete email account",
    toolset: "mailboxes",
    operation: "DELETE /domains/{domain}/email-accounts/{username}",
    description:
      "Permanently deletes a mailbox and the mail stored in it (irreversible).",
    input: { domain: domainArg, username: localPart("Mailbox name to delete") },
    doneMessage: (a) => `Email account ${String(a["username"])}@${String(a["domain"])} was deleted.`,
  }),

  // --- forwarders ---------------------------------------------------------------
  tool({
    name: "list_forwarders",
    title: "List email forwarders",
    toolset: "forwarders",
    operation: "GET /domains/{domain}/forwarders",
    description: "Lists the email forwarders on a domain and the destinations each one forwards to.",
    input: { domain: domainArg },
  }),
  tool({
    name: "create_forwarder",
    title: "Create email forwarder",
    toolset: "forwarders",
    operation: "POST /domains/{domain}/forwarders",
    description:
      "Creates a forwarder `alias@domain` that sends mail to one or more destinations; the special destination " +
      "`:blackhole:` silently discards all mail to it (confirm with the user first) and `:fail:` rejects it. " +
      "Forwarding to Yahoo, AOL, Gmail and similar providers automatically enables Expert Spam Filtering for the domain.",
    input: {
      domain: domainArg,
      alias: localPart("Forwarder name to create"),
      destinations: z
        .array(z.string().min(1))
        .min(1)
        .describe("Destination email addresses, or the special values :blackhole: / :fail:"),
    },
    doneMessage: (a) => `Forwarder ${String(a["alias"])}@${String(a["domain"])} was created.`,
  }),
  tool({
    name: "delete_forwarder",
    title: "Delete email forwarder",
    toolset: "forwarders",
    operation: "DELETE /domains/{domain}/forwarders/{alias}",
    description: "Deletes an email forwarder. Mail sent to that address will no longer be forwarded.",
    input: { domain: domainArg, alias: localPart("Forwarder name to delete") },
    doneMessage: (a) => `Forwarder ${String(a["alias"])}@${String(a["domain"])} was deleted.`,
  }),
];
