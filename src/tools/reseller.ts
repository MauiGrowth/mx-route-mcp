import { z } from "zod";
import { ToolInputError } from "../client.js";
import { countOrUnlimited, limitToString, sizeOrUnlimited, tool, type Args, type ToolDef } from "./define.js";

const RESELLER_ONLY =
  " Reseller accounts only (regular accounts are refused, typically with 403) and not available while " +
  "MXROUTE_USERNAME is in `reseller|user` form.";

const resellerUsername = z.string().min(1).describe("Username of the reseller's user account, e.g. johndoe");
const packageName = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, underscores and hyphens only")
  .describe("Package name (letters, numbers, underscores, hyphens)");

const quotaMb = countOrUnlimited("Disk quota in MB, or the string 'unlimited'");

const packageLimits = {
  quota: sizeOrUnlimited("Disk quota in GB (may be fractional), or 'unlimited'"),
  domains: countOrUnlimited("Number of domains, or 'unlimited'"),
  email_accounts: countOrUnlimited(
    "Usable customer mailbox limit, or 'unlimited'. 0 permits no customer mailboxes; the system mailbox is not counted",
  ),
  email_forwarders: countOrUnlimited("Number of forwarders, or 'unlimited'"),
  domain_pointers: countOrUnlimited("Number of domain pointers, or 'unlimited'"),
};
const PACKAGE_FIELDS = Object.keys(packageLimits);

/** Package fields are strings in the API; accept numbers too and stringify. */
function packageBody(args: Args): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (args["name"] !== undefined) body["name"] = args["name"];
  for (const key of PACKAGE_FIELDS) {
    const value = limitToString(args[key]);
    if (value !== undefined) body[key] = value;
  }
  return body;
}

export const resellerTools: ToolDef[] = [
  // --- users --------------------------------------------------------------------
  tool({
    name: "list_reseller_users",
    title: "List reseller users",
    toolset: "reseller_users",
    operation: "GET /reseller/users",
    description: `Lists the usernames of all user accounts under the reseller.${RESELLER_ONLY}`,
  }),
  tool({
    name: "get_reseller_user",
    title: "Get reseller user",
    toolset: "reseller_users",
    operation: "GET /reseller/users/{username}",
    description: `Returns a user's email, primary domain, package, suspended state and disk quota.${RESELLER_ONLY}`,
    input: { username: resellerUsername },
  }),
  tool({
    name: "create_reseller_user",
    title: "Create reseller user",
    toolset: "reseller_users",
    operation: "POST /reseller/users",
    description:
      `Creates a new user account under the reseller, assigned to an existing package. The password is sent to ` +
      `MXroute and never shown in the result.${RESELLER_ONLY}`,
    input: {
      username: z
        .string()
        .regex(/^[a-z0-9_]{1,10}$/, "1-10 characters: lowercase letters, numbers, underscores")
        .describe("New username: 1-10 characters, lowercase letters, numbers and underscores"),
      email: z
        .string()
        .regex(/^[^\s@]+@[^\s@]+$/, "Must be an email address")
        .describe("Contact email address for the account"),
      password: z.string().min(8).describe("Account password, at least 8 characters"),
      package: z.string().min(1).describe("Name of an existing package to assign (see list_packages)"),
    },
    doneMessage: (a) => `Reseller user ${String(a["username"])} was created.`,
  }),
  tool({
    name: "update_reseller_user",
    title: "Update reseller user",
    toolset: "reseller_users",
    operation: "PATCH /reseller/users/{username}",
    description:
      `Changes a user's disk quota and/or password. Provide at least one; omitted fields stay unchanged. ` +
      `Changing the password locks out anyone using the old one.${RESELLER_ONLY}`,
    input: {
      username: resellerUsername,
      quota: quotaMb.optional(),
      password: z.string().min(8).optional().describe("New password, at least 8 characters"),
    },
    destructive: true,
    validate: (args) => {
      if (args["quota"] === undefined && args["password"] === undefined) {
        throw new ToolInputError("Provide at least one of quota or password to update.");
      }
    },
    buildBody: (args) => {
      const body: Record<string, unknown> = {};
      const quota = limitToString(args["quota"]);
      if (quota !== undefined) body["quota"] = quota;
      if (args["password"] !== undefined) body["password"] = args["password"];
      return body;
    },
    doneMessage: (a) => `Reseller user ${String(a["username"])} was updated.`,
  }),
  tool({
    name: "delete_reseller_user",
    title: "Delete reseller user",
    toolset: "reseller_users",
    operation: "DELETE /reseller/users/{username}",
    description:
      `Permanently deletes a user account and everything in it (domains, mailboxes, mail); irreversible.${RESELLER_ONLY}`,
    input: { username: resellerUsername },
    doneMessage: (a) => `Reseller user ${String(a["username"])} was deleted.`,
  }),
  tool({
    name: "suspend_reseller_user",
    title: "Suspend reseller user",
    toolset: "reseller_users",
    operation: "POST /reseller/users/{username}/suspend",
    description: `Suspends a user account, which interrupts their service until unsuspended.${RESELLER_ONLY}`,
    input: { username: resellerUsername },
    destructive: true,
    idempotent: true,
    doneMessage: (a) => `Reseller user ${String(a["username"])} was suspended.`,
  }),
  tool({
    name: "unsuspend_reseller_user",
    title: "Unsuspend reseller user",
    toolset: "reseller_users",
    operation: "POST /reseller/users/{username}/unsuspend",
    description: `Restores a suspended user account.${RESELLER_ONLY}`,
    input: { username: resellerUsername },
    idempotent: true,
    doneMessage: (a) => `Reseller user ${String(a["username"])} was unsuspended.`,
  }),
  tool({
    name: "change_reseller_user_package",
    title: "Change reseller user's package",
    toolset: "reseller_users",
    operation: "PATCH /reseller/users/{username}/package",
    description:
      `Assigns a different package to a user. Returns 422 if the package does not exist. ` +
      `Returns the updated user.${RESELLER_ONLY}`,
    input: {
      username: resellerUsername,
      package: z.string().min(1).describe("Name of the package to assign, e.g. premium"),
    },
  }),

  // --- packages -----------------------------------------------------------------
  tool({
    name: "list_packages",
    title: "List packages",
    toolset: "reseller_packages",
    operation: "GET /reseller/packages",
    description: `Lists the names of the reseller's packages.${RESELLER_ONLY}`,
  }),
  tool({
    name: "get_package",
    title: "Get package",
    toolset: "reseller_packages",
    operation: "GET /reseller/packages/{name}",
    description:
      `Returns a package's limits: disk quota (GB), domains, mailboxes, forwarders and domain pointers. A null ` +
      `limit means unlimited; quota_unlimited flags an unlimited disk quota.${RESELLER_ONLY}`,
    input: { name: packageName },
  }),
  tool({
    name: "create_package",
    title: "Create package",
    toolset: "reseller_packages",
    operation: "POST /reseller/packages",
    description:
      `Creates a package. Omitted limits use the API defaults: quota 1 GB, 1 domain, 100 mailboxes, ` +
      `100 forwarders, 10 domain pointers.${RESELLER_ONLY}`,
    input: {
      name: packageName.describe("Name for the new package (letters, numbers, underscores, hyphens)"),
      quota: packageLimits.quota.optional(),
      domains: packageLimits.domains.optional(),
      email_accounts: packageLimits.email_accounts.optional(),
      email_forwarders: packageLimits.email_forwarders.optional(),
      domain_pointers: packageLimits.domain_pointers.optional(),
    },
    buildBody: packageBody,
    doneMessage: (a) => `Package ${String(a["name"])} was created.`,
  }),
  tool({
    name: "update_package",
    title: "Update package",
    toolset: "reseller_packages",
    operation: "PATCH /reseller/packages/{name}",
    description:
      `Changes a package's limits. Provide at least one limit; omitted limits are preserved.${RESELLER_ONLY}`,
    input: {
      name: packageName,
      quota: packageLimits.quota.optional(),
      domains: packageLimits.domains.optional(),
      email_accounts: packageLimits.email_accounts.optional(),
      email_forwarders: packageLimits.email_forwarders.optional(),
      domain_pointers: packageLimits.domain_pointers.optional(),
    },
    validate: (args) => {
      if (!PACKAGE_FIELDS.some((key) => args[key] !== undefined)) {
        throw new ToolInputError(`Provide at least one limit to update (${PACKAGE_FIELDS.join(", ")}).`);
      }
    },
    buildBody: (args) => {
      const { name: _name, ...rest } = packageBody(args);
      return rest;
    },
    doneMessage: (a) => `Package ${String(a["name"])} was updated.`,
  }),
  tool({
    name: "delete_package",
    title: "Delete package",
    toolset: "reseller_packages",
    operation: "DELETE /reseller/packages/{name}",
    description: `Deletes a package. Fails with 422 if any user is still assigned to it.${RESELLER_ONLY}`,
    input: { name: packageName },
    doneMessage: (a) => `Package ${String(a["name"])} was deleted.`,
  }),
];
