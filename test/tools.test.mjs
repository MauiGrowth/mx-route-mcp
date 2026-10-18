import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { normalise } from "../scripts/lib/openapi.mjs";
import { ALL_TOOLS } from "../dist/tools/index.js";
import { DESTRUCTIVE_NOTE } from "../dist/tools/define.js";
import { CREDS, startMockApi } from "./helpers/mock-api.mjs";
import { connect, textOf } from "./helpers/stdio.mjs";

const execFileAsync = promisify(execFile);

const operations = JSON.parse(
  readFileSync(new URL("../spec/operations.json", import.meta.url), "utf8"),
).operations;

describe("tool registry", () => {
  it("has exactly one tool per MXroute API operation", () => {
    const covered = ALL_TOOLS.map((t) => {
      const [method, path] = t.operation.split(" ");
      return `${method} ${normalise(path)}`;
    });
    assert.equal(new Set(covered).size, covered.length, "two tools map to the same operation");
    assert.deepEqual([...covered].sort(), [...operations].sort());
  });

  it("uses unique snake_case names, titles and descriptions", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    for (const t of ALL_TOOLS) {
      assert.match(t.name, /^[a-z][a-z0-9_]*$/, t.name);
      assert.ok(t.title.length > 0, t.name);
      assert.ok(t.description.length >= 30, `${t.name} needs a real description`);
    }
  });

  it("declares every path parameter as an input", () => {
    for (const t of ALL_TOOLS) {
      const params = [...t.operation.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const p of params) assert.ok(p in t.input, `${t.name} is missing path input "${p}"`);
    }
  });

  it("derives behaviour hints from the HTTP method", () => {
    for (const t of ALL_TOOLS) {
      const method = t.operation.split(" ")[0];
      if (method === "GET") {
        assert.equal(t.readOnly, true, t.name);
        assert.equal(t.destructive, false, t.name);
      } else {
        assert.equal(t.readOnly, false, t.name);
      }
      if (method === "DELETE") assert.equal(t.destructive, true, t.name);
      if (t.name.startsWith("create_") || t.name.startsWith("add_")) {
        assert.equal(t.destructive, false, t.name);
        assert.equal(t.idempotent, false, t.name);
      }
    }
  });
});

// The behaviour hints are a safety contract with MCP clients, so they are pinned explicitly:
// changing one must be a deliberate edit to this list, not a side effect.
const DESTRUCTIVE = [
  "delete_domain", "set_mail_hosting_status", "delete_domain_pointer", "set_catch_all",
  "update_email_account", "delete_email_account", "delete_forwarder", "update_spam_settings",
  "remove_spam_whitelist_entry", "remove_spam_blacklist_entry", "update_reseller_user",
  "delete_reseller_user", "suspend_reseller_user", "delete_package",
];
const NON_IDEMPOTENT = [
  "create_domain", "create_domain_pointer", "create_email_account", "create_forwarder",
  "add_spam_whitelist_entry", "add_spam_blacklist_entry", "create_reseller_user", "create_package",
];

describe("behaviour hints", () => {
  it("marks exactly the reviewed set of tools destructive", () => {
    assert.deepEqual(ALL_TOOLS.filter((t) => t.destructive).map((t) => t.name).sort(), [...DESTRUCTIVE].sort());
  });

  it("marks exactly the creating tools non-idempotent (reads are idempotent)", () => {
    assert.deepEqual(
      ALL_TOOLS.filter((t) => !t.readOnly && !t.idempotent).map((t) => t.name).sort(),
      [...NON_IDEMPOTENT].sort(),
    );
  });

  it("repeats the confirmation cue in the description of every destructive tool", () => {
    for (const t of ALL_TOOLS) {
      assert.equal(t.description.includes(DESTRUCTIVE_NOTE), t.destructive, t.name);
    }
  });
});

describe("README", () => {
  it("lists every tool and its tools table is in sync with the code", async () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const t of ALL_TOOLS) assert.ok(readme.includes(`\`${t.name}\``), `README is missing ${t.name}`);
    const script = fileURLToPath(new URL("../scripts/gen-readme-tools.mjs", import.meta.url));
    await execFileAsync(process.execPath, [script, "--check"]); // rejects if stale
  });
});

// Every tool, called with plausible arguments, must hit the right method, path and body.
const EX = "example.com";
const CASES = [
  ["get_domain_verification_key", {}, "GET", "/verification-key"],
  ["list_domains", {}, "GET", "/domains"],
  ["get_domain", { domain: EX }, "GET", `/domains/${EX}`],
  ["create_domain", { domain: EX }, "POST", "/domains", { domain: EX }],
  ["delete_domain", { domain: EX }, "DELETE", `/domains/${EX}`],
  ["set_mail_hosting_status", { domain: EX, enabled: false }, "PATCH", `/domains/${EX}/mail-status`, { enabled: false }],
  ["list_domain_pointers", { domain: EX }, "GET", `/domains/${EX}/pointers`],
  ["create_domain_pointer", { domain: EX, pointer: "alias.com", alias: false }, "POST", `/domains/${EX}/pointers`, { pointer: "alias.com", alias: false }],
  ["delete_domain_pointer", { domain: EX, pointer: "alias.com" }, "DELETE", `/domains/${EX}/pointers/alias.com`],
  ["get_dns_records", { domain: EX }, "GET", `/domains/${EX}/dns`],
  ["get_catch_all", { domain: EX }, "GET", `/domains/${EX}/catch-all`],
  ["set_catch_all", { domain: EX, type: "address", address: "all@example.com" }, "PATCH", `/domains/${EX}/catch-all`, { type: "address", address: "all@example.com" }],
  ["list_email_accounts", { domain: EX }, "GET", `/domains/${EX}/email-accounts`],
  ["get_email_account", { domain: EX, username: "info" }, "GET", `/domains/${EX}/email-accounts/info`],
  ["create_email_account", { domain: EX, username: "info", password: "Sup3rSecret!", quota: 2048, limit: 500 }, "POST", `/domains/${EX}/email-accounts`, { username: "info", password: "Sup3rSecret!", quota: 2048, limit: 500 }],
  ["update_email_account", { domain: EX, username: "info", quota: 512 }, "PATCH", `/domains/${EX}/email-accounts/info`, { quota: 512 }],
  ["delete_email_account", { domain: EX, username: "info" }, "DELETE", `/domains/${EX}/email-accounts/info`],
  ["list_forwarders", { domain: EX }, "GET", `/domains/${EX}/forwarders`],
  ["create_forwarder", { domain: EX, alias: "sales", destinations: ["a@x.com", "b@y.com"] }, "POST", `/domains/${EX}/forwarders`, { alias: "sales", destinations: ["a@x.com", "b@y.com"] }],
  ["delete_forwarder", { domain: EX, alias: "sales" }, "DELETE", `/domains/${EX}/forwarders/sales`],
  ["get_spam_settings", { domain: EX }, "GET", `/domains/${EX}/spam/settings`],
  ["update_spam_settings", { domain: EX, high_score: 10 }, "PATCH", `/domains/${EX}/spam/settings`, { high_score: 10 }],
  ["list_spam_whitelist", { domain: EX }, "GET", `/domains/${EX}/spam/whitelist`],
  ["add_spam_whitelist_entry", { domain: EX, entry: "*@trusted.com" }, "POST", `/domains/${EX}/spam/whitelist`, { entry: "*@trusted.com" }],
  ["remove_spam_whitelist_entry", { domain: EX, entry: "*@trusted.com" }, "DELETE", `/domains/${EX}/spam/whitelist/*%40trusted.com`],
  ["list_spam_blacklist", { domain: EX }, "GET", `/domains/${EX}/spam/blacklist`],
  ["add_spam_blacklist_entry", { domain: EX, entry: "bad@spam.example" }, "POST", `/domains/${EX}/spam/blacklist`, { entry: "bad@spam.example" }],
  ["remove_spam_blacklist_entry", { domain: EX, entry: "bad@spam.example" }, "DELETE", `/domains/${EX}/spam/blacklist/bad%40spam.example`],
  ["get_quota", {}, "GET", "/quota"],
  ["get_email_usage", {}, "GET", "/quota/email"],
  ["list_reseller_users", {}, "GET", "/reseller/users"],
  ["get_reseller_user", { username: "johndoe" }, "GET", "/reseller/users/johndoe"],
  ["create_reseller_user", { username: "johndoe", email: "john@example.com", password: "Passw0rd!x", package: "basic" }, "POST", "/reseller/users", { username: "johndoe", email: "john@example.com", password: "Passw0rd!x", package: "basic" }],
  ["update_reseller_user", { username: "johndoe", quota: 2048, password: "NewPassw0rd!" }, "PATCH", "/reseller/users/johndoe", { quota: "2048", password: "NewPassw0rd!" }],
  ["delete_reseller_user", { username: "johndoe" }, "DELETE", "/reseller/users/johndoe"],
  ["suspend_reseller_user", { username: "johndoe" }, "POST", "/reseller/users/johndoe/suspend"],
  ["unsuspend_reseller_user", { username: "johndoe" }, "POST", "/reseller/users/johndoe/unsuspend"],
  ["change_reseller_user_package", { username: "johndoe", package: "premium" }, "PATCH", "/reseller/users/johndoe/package", { package: "premium" }],
  ["list_packages", {}, "GET", "/reseller/packages"],
  ["get_package", { name: "basic" }, "GET", "/reseller/packages/basic"],
  ["create_package", { name: "basic", quota: 5, domains: "unlimited", email_accounts: 100 }, "POST", "/reseller/packages", { name: "basic", quota: "5", domains: "unlimited", email_accounts: "100" }],
  ["update_package", { name: "basic", quota: 10, email_accounts: 0 }, "PATCH", "/reseller/packages/basic", { quota: "10", email_accounts: "0" }],
  ["delete_package", { name: "basic" }, "DELETE", "/reseller/packages/basic"],
];

describe("stdio server against a mock MXroute API", () => {
  let api;
  let session;

  before(async () => {
    api = await startMockApi((req) => {
      if (req.method === "DELETE") return { status: 204 };
      if (req.url === "/quota") return { json: { username: "johndoe", total_used: 1, total_limit: 0 } };
      if (req.url === "/domains/boom.example") {
        return { status: 400, json: { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid domain format", field: "domain" } } };
      }
      return { status: req.method === "POST" ? 201 : 200, json: { success: true, data: { echoed: req.url } } };
    });
    session = await connect({
      MXROUTE_SERVER: CREDS.server,
      MXROUTE_USERNAME: CREDS.username,
      MXROUTE_API_KEY: CREDS.apiKey,
      MXROUTE_API_URL: api.url,
    });
  });

  after(async () => {
    await session?.close();
    await api?.close();
  });

  it("registers all tools with complete annotations and object input schemas", async () => {
    const { tools } = await session.client.listTools();
    assert.equal(tools.length, ALL_TOOLS.length);
    assert.equal(tools.length, operations.length);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object", t.name);
      const a = t.annotations;
      assert.ok(a, `${t.name} has no annotations`);
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof a[key], "boolean", `${t.name}.${key}`);
      }
      assert.equal(a.openWorldHint, true);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(byName.list_domains.annotations.readOnlyHint, true);
    assert.equal(byName.delete_email_account.annotations.destructiveHint, true);
    assert.equal(byName.create_email_account.annotations.destructiveHint, false);
  });

  for (const [name, args, method, path, body] of CASES) {
    it(`${name} -> ${method} ${path}`, async () => {
      api.requests.length = 0;
      const result = await session.client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, textOf(result));
      assert.equal(api.requests.length, 1);
      const [req] = api.requests;
      assert.equal(req.method, method);
      assert.equal(req.url, path);
      assert.deepEqual(req.body, body);
      // credentials travel only in headers
      assert.equal(req.headers["x-api-key"], CREDS.apiKey);
      assert.ok(!req.raw.includes(CREDS.apiKey));
      // the result is valid JSON the model can read
      JSON.parse(textOf(result));
    });
  }

  it("covers every tool in the table above", () => {
    assert.deepEqual(CASES.map((c) => c[0]).sort(), ALL_TOOLS.map((t) => t.name).sort());
  });

  it("turns a 204 into an explicit confirmation message", async () => {
    const result = await session.client.callTool({ name: "delete_domain", arguments: { domain: EX } });
    assert.deepEqual(JSON.parse(textOf(result)), { ok: true, message: "Domain example.com was deleted." });
  });

  it("returns /quota as-is", async () => {
    const result = await session.client.callTool({ name: "get_quota", arguments: {} });
    assert.equal(JSON.parse(textOf(result)).total_used, 1);
  });

  it("maps API errors to isError results with code and field, and never leaks the key", async () => {
    const result = await session.client.callTool({ name: "get_domain", arguments: { domain: "boom.example" } });
    assert.equal(result.isError, true);
    const text = textOf(result);
    assert.match(text, /Invalid domain format/);
    assert.match(text, /VALIDATION_ERROR/);
    assert.match(text, /field "domain"/);
    assert.ok(!text.includes(CREDS.apiKey));
  });

  it("rejects update calls with nothing to update, before sending anything", async () => {
    api.requests.length = 0;
    const result = await session.client.callTool({ name: "update_email_account", arguments: { domain: EX, username: "info" } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /at least one of password, quota or limit/);
    assert.equal(api.requests.length, 0);
  });

  it("validates catch-all address rules", async () => {
    api.requests.length = 0;
    const missing = await session.client.callTool({ name: "set_catch_all", arguments: { domain: EX, type: "address" } });
    assert.equal(missing.isError, true);
    const extra = await session.client.callTool({ name: "set_catch_all", arguments: { domain: EX, type: "fail", address: "a@b.com" } });
    assert.equal(extra.isError, true);
    assert.equal(api.requests.length, 0);
  });

  it("rejects schema-invalid arguments without sending a request", async () => {
    api.requests.length = 0;
    let result;
    try {
      result = await session.client.callTool({
        name: "create_email_account",
        arguments: { domain: EX, username: "info", password: "short" },
      });
    } catch (err) {
      result = { isError: true, content: [{ type: "text", text: String(err.message) }] };
    }
    assert.equal(result.isError, true);
    assert.equal(api.requests.length, 0);
  });

  it("rejects misspelled or unknown arguments instead of silently dropping them", async () => {
    api.requests.length = 0;
    const result = await session.client.callTool({
      name: "create_email_account",
      arguments: { domain: EX, username: "info", password: "Sup3rSecret!", quotta: 5000 },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /quotta|Unrecognized|unrecognized/);
    assert.equal(api.requests.length, 0);
    const { tools } = await session.client.listTools();
    assert.equal(tools.find((t) => t.name === "create_email_account").inputSchema.additionalProperties, false);
  });

  it("does not echo a rejected password back in the validation error", async () => {
    const secret = "tooShrt";
    const result = await session.client.callTool({
      name: "create_email_account",
      arguments: { domain: EX, username: "info", password: secret },
    });
    assert.equal(result.isError, true);
    assert.ok(!textOf(result).includes(secret));
  });

  it("rejects full addresses and URLs where a bare name is expected", async () => {
    api.requests.length = 0;
    const cases = [
      ["create_email_account", { domain: EX, username: "info@example.com", password: "Sup3rSecret!" }],
      ["delete_forwarder", { domain: EX, alias: "sales@example.com" }],
      ["get_domain", { domain: "https://example.com" }],
      ["get_domain", { domain: "exa mple.com" }],
      ["get_package", { name: "my package" }],
    ];
    for (const [name, args] of cases) {
      const result = await session.client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name} ${JSON.stringify(args)}`);
    }
    assert.equal(api.requests.length, 0);
  });

  it("rejects package limits the API cannot take", async () => {
    const result = await session.client.callTool({ name: "create_package", arguments: { name: "basic", domains: "Unlimited" } });
    assert.equal(result.isError, true);
  });

  it("reports a lone surrogate as an input error, not an unexpected crash", async () => {
    const result = await session.client.callTool({ name: "get_domain", arguments: { domain: "bad\ud800.com" } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Invalid characters/);
  });

  it("refuses path-traversal values", async () => {
    api.requests.length = 0;
    const result = await session.client.callTool({ name: "get_domain", arguments: { domain: ".." } });
    assert.equal(result.isError, true);
    assert.equal(api.requests.length, 0);
  });

  it("never prints credentials to stderr", () => {
    assert.ok(!session.stderr.includes(CREDS.apiKey));
  });
});

describe("startup behaviour", () => {
  it("starts and lists tools without credentials, then explains what is missing on first use", async () => {
    const s = await connect({});
    try {
      const { tools } = await s.client.listTools();
      assert.equal(tools.length, ALL_TOOLS.length);
      const result = await s.client.callTool({ name: "list_domains", arguments: {} });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /MXROUTE_SERVER, MXROUTE_USERNAME, MXROUTE_API_KEY/);
    } finally {
      await s.close();
    }
  });

  it("MXROUTE_READ_ONLY registers only read-only tools, and they are the only ones callable", async () => {
    const s = await connect({ MXROUTE_READ_ONLY: "true" });
    try {
      const { tools } = await s.client.listTools();
      const reads = operations.filter((o) => o.startsWith("GET ")).length;
      assert.equal(tools.length, reads);
      assert.ok(tools.every((t) => t.annotations.readOnlyHint === true));
      // instructions must not point the model at tools that are not registered
      const instructions = s.client.getInstructions() ?? "";
      assert.ok(!instructions.includes("create_domain"), instructions);
      assert.match(instructions, /get_dns_records/);
      // a filtered-out tool cannot be invoked by name
      let result;
      try {
        result = await s.client.callTool({ name: "delete_domain", arguments: { domain: "example.com" } });
      } catch (err) {
        result = { isError: true, content: [{ type: "text", text: String(err.message) }] };
      }
      assert.equal(result.isError, true);
      assert.match(textOf(result), /not found|Unknown tool|unknown tool/i);
    } finally {
      await s.close();
    }
  });

  it("MXROUTE_TOOLSETS limits the registered tools", async () => {
    const s = await connect({ MXROUTE_TOOLSETS: "quota,dns" });
    try {
      const { tools } = await s.client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), ["get_dns_records", "get_email_usage", "get_quota"]);
    } finally {
      await s.close();
    }
  });

  it("exits non-zero when MXROUTE_READ_ONLY is not a recognisable boolean (fail closed, not open)", () => {
    const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const r = spawnSync(process.execPath, [entry], { env: { PATH: process.env.PATH, MXROUTE_READ_ONLY: "ture" }, encoding: "utf8", timeout: 10000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /MXROUTE_READ_ONLY must be one of/);
  });

  it("exits non-zero on an unknown toolset", () => {
    const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const r = spawnSync(process.execPath, [entry], { env: { PATH: process.env.PATH, MXROUTE_TOOLSETS: "bogus" }, encoding: "utf8", timeout: 10000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unknown MXROUTE_TOOLSETS/);
  });

  it("rejects extra and unknown CLI arguments", () => {
    const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    for (const args of [["--tools", "--check"], ["--bogus"]]) {
      const r = spawnSync(process.execPath, [entry, ...args], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10000 });
      assert.equal(r.status, 2, args.join(" "));
    }
  });

  it("--version, --help and --tools work", () => {
    const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const run = (arg) => spawnSync(process.execPath, [entry, arg], { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10000 });
    assert.match(run("--version").stdout, /^\d+\.\d+\.\d+\n$/);
    assert.match(run("--help").stdout, /MXROUTE_API_KEY/);
    assert.match(run("--help").stdout, /reseller_packages/); // toolset names are discoverable
    assert.match(run("--tools").stdout, /43 of 43 tools enabled/);
  });

  it("--check authenticates against the API and reports the domain count", async () => {
    const api = await startMockApi(() => ({ json: { success: true, data: ["a.com", "b.com"] } }));
    try {
      const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      // Async spawn: the mock API lives in this process, so a blocking spawnSync would deadlock.
      const { stdout, stderr } = await execFileAsync(process.execPath, [entry, "--check"], {
        env: { PATH: process.env.PATH, MXROUTE_SERVER: CREDS.server, MXROUTE_USERNAME: CREDS.username, MXROUTE_API_KEY: CREDS.apiKey, MXROUTE_API_URL: api.url },
        timeout: 10000,
      });
      assert.match(stdout, /OK: authenticated to eagle\.mxlogin\.com as johndoe; 2 domains found\./);
      assert.ok(!stdout.includes(CREDS.apiKey) && !stderr.includes(CREDS.apiKey));
      assert.equal(api.requests[0].url, "/domains");
    } finally {
      await api.close();
    }

    // an API that answers with something other than a domain list is not "authenticated"
    const odd = await startMockApi(() => ({ json: { hello: "world" } }));
    try {
      const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      await assert.rejects(
        execFileAsync(process.execPath, [entry, "--check"], {
          env: { PATH: process.env.PATH, MXROUTE_SERVER: CREDS.server, MXROUTE_USERNAME: CREDS.username, MXROUTE_API_KEY: CREDS.apiKey, MXROUTE_API_URL: odd.url },
          timeout: 10000,
        }),
        (err) => err.code === 1 && /not with a list of domains/.test(err.stderr),
      );
    } finally {
      await odd.close();
    }

    // and a failed check exits non-zero with a readable message
    const bad = await startMockApi(() => ({ status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "Invalid API credentials" } } }));
    try {
      const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      await assert.rejects(
        execFileAsync(process.execPath, [entry, "--check"], {
          env: { PATH: process.env.PATH, MXROUTE_SERVER: CREDS.server, MXROUTE_USERNAME: CREDS.username, MXROUTE_API_KEY: CREDS.apiKey, MXROUTE_API_URL: bad.url },
          timeout: 10000,
        }),
        (err) => {
          assert.equal(err.code, 1);
          assert.match(err.stderr, /Invalid API credentials/);
          assert.ok(!err.stderr.includes(CREDS.apiKey));
          return true;
        },
      );
    } finally {
      await bad.close();
    }
  });
});
