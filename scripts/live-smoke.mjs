// Read-only smoke test against YOUR real MXroute account, through the real MCP server.
//
//   MXROUTE_SERVER=... MXROUTE_USERNAME=... MXROUTE_API_KEY=... npm run smoke:live
//
// The server is started with MXROUTE_READ_ONLY=true, so write tools are not even
// registered and nothing can be changed. Only counts and field names are printed,
// never domain names, addresses or other account data. Reseller tools are
// reported as skipped when the account is not a reseller (HTTP 403).
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { MXROUTE_SERVER, MXROUTE_USERNAME, MXROUTE_API_KEY } = process.env;
if (!MXROUTE_SERVER || !MXROUTE_USERNAME || !MXROUTE_API_KEY) {
  console.error("Set MXROUTE_SERVER, MXROUTE_USERNAME and MXROUTE_API_KEY first.");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
  env: { MXROUTE_SERVER, MXROUTE_USERNAME, MXROUTE_API_KEY, MXROUTE_READ_ONLY: "true" },
  stderr: "pipe",
});
const client = new Client({ name: "mx-route-mcp-live-smoke", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
const count = (n, noun, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const hasKeys = (v, keys) => isObj(v) && keys.every((k) => k in v);

async function run(label, name, args, check, { optional = false } = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.find((c) => c.type === "text")?.text ?? "";
  if (r.isError) {
    if (optional && /HTTP 403/.test(text)) {
      console.log(`  skip  ${label} (requires a reseller account)`);
      return undefined;
    }
    failures++;
    console.log(`  FAIL  ${label}: ${text.slice(0, 200)}`);
    return undefined;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    failures++;
    console.log(`  FAIL  ${label}: result is not JSON`);
    return undefined;
  }
  const verdict = check(data);
  if (verdict === true || typeof verdict === "string") {
    console.log(`  ok    ${label}${typeof verdict === "string" ? ` (${verdict})` : ""}`);
    return data;
  }
  failures++;
  console.log(`  FAIL  ${label}: unexpected shape (${isObj(data) ? `keys: ${Object.keys(data).join(",")}` : Array.isArray(data) ? `array of ${data.length}` : typeof data})`);
  return undefined;
}

const { tools } = await client.listTools();
console.log(`read-only server registered ${tools.length} tools\n`);

await run("get_domain_verification_key", "get_domain_verification_key", {}, (d) => hasKeys(d, ["key", "record"]));
const domains = await run("list_domains", "list_domains", {}, (d) => Array.isArray(d) && d.every((x) => typeof x === "string") && count(d.length, "domain"));
await run("get_quota", "get_quota", {}, (d) => hasKeys(d, ["total_used", "total_limit", "breakdown"]));
await run("get_email_usage", "get_email_usage", {}, (d) => hasKeys(d, ["accounts"]) && Array.isArray(d.accounts) && count(d.accounts.length, "mailbox", "mailboxes"));
await run("list_reseller_users", "list_reseller_users", {}, (d) => Array.isArray(d) && count(d.length, "user"), { optional: true });
await run("list_packages", "list_packages", {}, (d) => Array.isArray(d) && count(d.length, "package"), { optional: true });

const domain = Array.isArray(domains) ? domains[0] : undefined;
if (domain) {
  console.log("\n  (per-domain tools run against the first domain on the account)");
  await run("get_domain", "get_domain", { domain }, (d) => hasKeys(d, ["domain", "mail_hosting", "ssl_enabled"]));
  await run("list_domain_pointers", "list_domain_pointers", { domain }, (d) => Array.isArray(d) && count(d.length, "pointer"));
  await run("get_dns_records", "get_dns_records", { domain }, (d) => hasKeys(d, ["mx_records", "spf"]));
  await run("get_catch_all", "get_catch_all", { domain }, (d) => hasKeys(d, ["type"]) && ["fail", "blackhole", "address"].includes(d.type) && `type ${d.type}`);
  const boxes = await run("list_email_accounts", "list_email_accounts", { domain }, (d) => Array.isArray(d) && d.every((x) => hasKeys(x, ["username", "email", "quota"])) && count(d.length, "mailbox", "mailboxes"));
  await run("list_forwarders", "list_forwarders", { domain }, (d) => Array.isArray(d) && d.every((x) => hasKeys(x, ["alias", "destinations"])) && count(d.length, "forwarder"));
  await run("get_spam_settings", "get_spam_settings", { domain }, (d) => hasKeys(d, ["high_score"]) && Number.isInteger(d.high_score));
  await run("list_spam_whitelist", "list_spam_whitelist", { domain }, (d) => Array.isArray(d) && `${d.length} ${d.length === 1 ? "entry" : "entries"}`);
  await run("list_spam_blacklist", "list_spam_blacklist", { domain }, (d) => Array.isArray(d) && `${d.length} ${d.length === 1 ? "entry" : "entries"}`);
  if (Array.isArray(boxes) && boxes[0]) {
    await run("get_email_account", "get_email_account", { domain, username: boxes[0].username }, (d) => hasKeys(d, ["username", "email", "quota", "usage"]));
  }
} else {
  console.log("\n  no domains on this account: per-domain tools were not exercised");
}

await client.close();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
