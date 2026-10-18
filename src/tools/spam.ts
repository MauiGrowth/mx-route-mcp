import { z } from "zod";
import { domainArg, tool, type ToolDef } from "./define.js";

const entryPattern = /^[a-zA-Z0-9@.\-_*+=]+$/;

const newEntry = z
  .string()
  .min(1)
  .max(254)
  .regex(entryPattern, "Only letters, digits and @ . - _ * + = are allowed")
  .describe("Email address or pattern; * wildcards are supported, e.g. *@trusted.com (max 254 chars)");

const existingEntry = z.string().min(1).max(254).describe("The exact entry to remove, e.g. *@trusted.com");

const SHARED = " The domain argument must be one you own, but the lists themselves are account-wide.";

export const spamTools: ToolDef[] = [
  tool({
    name: "get_spam_settings",
    title: "Get spam settings",
    toolset: "spam",
    operation: "GET /domains/{domain}/spam/settings",
    description:
      "Returns the spam filter settings for a domain. high_score (1-50) is the score threshold for " +
      "auto-deletion of spam.",
    input: { domain: domainArg },
  }),
  tool({
    name: "update_spam_settings",
    title: "Update spam settings",
    toolset: "spam",
    operation: "PATCH /domains/{domain}/spam/settings",
    description:
      "Sets the high_score threshold (1-50) for automatic deletion of spam. Lower values are stricter and risk " +
      "deleting legitimate mail. If the call fails with an unconfirmed-save error, read the settings with " +
      "get_spam_settings before retrying.",
    input: {
      domain: domainArg,
      high_score: z.number().int().min(1).max(50).describe("Auto-delete score threshold, 1-50"),
    },
    destructive: true,
    doneMessage: (a) => `Spam high_score for ${String(a["domain"])} is now ${String(a["high_score"])}.`,
  }),

  tool({
    name: "list_spam_whitelist",
    title: "List spam whitelist",
    toolset: "spam",
    operation: "GET /domains/{domain}/spam/whitelist",
    description: `Lists the account-wide whitelist: sender entries that are never treated as spam.${SHARED}`,
    input: { domain: domainArg },
  }),
  tool({
    name: "add_spam_whitelist_entry",
    title: "Add spam whitelist entry",
    toolset: "spam",
    operation: "POST /domains/{domain}/spam/whitelist",
    description:
      `Adds a sender email or wildcard pattern to the account-wide whitelist so its mail bypasses spam filtering ` +
      `on every domain. Returns 409 if the entry already exists (case-insensitive).${SHARED}`,
    input: { domain: domainArg, entry: newEntry },
    doneMessage: (a) => `Added ${String(a["entry"])} to the spam whitelist.`,
  }),
  tool({
    name: "remove_spam_whitelist_entry",
    title: "Remove spam whitelist entry",
    toolset: "spam",
    operation: "DELETE /domains/{domain}/spam/whitelist/{entry}",
    description: `Removes an entry from the account-wide spam whitelist.${SHARED}`,
    input: { domain: domainArg, entry: existingEntry },
    doneMessage: (a) => `Removed ${String(a["entry"])} from the spam whitelist.`,
  }),

  tool({
    name: "list_spam_blacklist",
    title: "List spam blacklist",
    toolset: "spam",
    operation: "GET /domains/{domain}/spam/blacklist",
    description: `Lists the account-wide blacklist: sender entries that are always treated as spam.${SHARED}`,
    input: { domain: domainArg },
  }),
  tool({
    name: "add_spam_blacklist_entry",
    title: "Add spam blacklist entry",
    toolset: "spam",
    operation: "POST /domains/{domain}/spam/blacklist",
    description:
      `Adds a sender email or wildcard pattern to the account-wide blacklist so its mail is always treated as spam ` +
      `on every domain. Returns 409 if the entry already exists (case-insensitive).${SHARED}`,
    input: { domain: domainArg, entry: newEntry },
    doneMessage: (a) => `Added ${String(a["entry"])} to the spam blacklist.`,
  }),
  tool({
    name: "remove_spam_blacklist_entry",
    title: "Remove spam blacklist entry",
    toolset: "spam",
    operation: "DELETE /domains/{domain}/spam/blacklist/{entry}",
    description: `Removes an entry from the account-wide spam blacklist.${SHARED}`,
    input: { domain: domainArg, entry: existingEntry },
    doneMessage: (a) => `Removed ${String(a["entry"])} from the spam blacklist.`,
  }),
];
