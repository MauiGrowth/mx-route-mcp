import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig, loadOptions } from "../dist/config.js";
import { redact } from "../dist/redact.js";

const good = {
  MXROUTE_SERVER: "eagle.mxlogin.com",
  MXROUTE_USERNAME: "johndoe",
  MXROUTE_API_KEY: "Mx_key",
};

describe("loadConfig", () => {
  it("loads credentials and applies defaults", () => {
    const c = loadConfig(good);
    assert.deepEqual(c, {
      server: "eagle.mxlogin.com",
      username: "johndoe",
      apiKey: "Mx_key",
      baseUrl: "https://api.mxroute.com",
      timeoutMs: 30000,
    });
  });

  it("names every missing variable and never mentions a key value", () => {
    assert.throws(() => loadConfig({ MXROUTE_API_KEY: "topsecret" }), (e) => {
      assert.ok(e instanceof ConfigError);
      assert.match(e.message, /MXROUTE_SERVER, MXROUTE_USERNAME/);
      assert.ok(!e.message.includes("topsecret"));
      return true;
    });
  });

  it("trims whitespace/newlines (common with .env files) and tolerates a pasted URL for the server", () => {
    const c = loadConfig({ ...good, MXROUTE_SERVER: " https://eagle.mxlogin.com/ ", MXROUTE_API_KEY: "Mx_key\n" });
    assert.equal(c.server, "eagle.mxlogin.com");
    assert.equal(c.apiKey, "Mx_key");
  });

  it("keeps colons and the reseller|user pipe form intact", () => {
    const c = loadConfig({ ...good, MXROUTE_USERNAME: "reseller|user", MXROUTE_API_KEY: "a:b:c" });
    assert.equal(c.username, "reseller|user");
    assert.equal(c.apiKey, "a:b:c");
  });

  it("rejects header-injection characters and non-ASCII text with a clear message", () => {
    assert.throws(() => loadConfig({ ...good, MXROUTE_USERNAME: "a\r\nX-Evil: 1" }), ConfigError);
    for (const key of ["key\u2014with-em-dash", "k\u00e9y", "ke y", "key\u200b"]) {
      assert.throws(() => loadConfig({ ...good, MXROUTE_API_KEY: key }), /printable ASCII/, JSON.stringify(key));
    }
    assert.throws(() => loadConfig({ ...good, MXROUTE_SERVER: "eagle.mxl\u00f6gin.com" }), /printable ASCII/);
  });

  it("requires https except for loopback, and rejects embedded credentials", () => {
    assert.throws(() => loadConfig({ ...good, MXROUTE_API_URL: "http://api.mxroute.com" }), ConfigError);
    assert.throws(() => loadConfig({ ...good, MXROUTE_API_URL: "https://u:p@api.mxroute.com" }), ConfigError);
    assert.throws(() => loadConfig({ ...good, MXROUTE_API_URL: "not a url" }), ConfigError);
    assert.throws(() => loadConfig({ ...good, MXROUTE_API_URL: "https://api.mxroute.com?x=1" }), /query string/);
    assert.throws(() => loadConfig({ ...good, MXROUTE_API_URL: "https://api.mxroute.com/#frag" }), /query string or fragment/);
    assert.equal(loadConfig({ ...good, MXROUTE_API_URL: "http://127.0.0.1:8080/" }).baseUrl, "http://127.0.0.1:8080");
    assert.equal(loadConfig({ ...good, MXROUTE_API_URL: "http://localhost:8080" }).baseUrl, "http://localhost:8080");
  });

  it("validates the timeout", () => {
    assert.equal(loadConfig({ ...good, MXROUTE_TIMEOUT_MS: "5000" }).timeoutMs, 5000);
    assert.throws(() => loadConfig({ ...good, MXROUTE_TIMEOUT_MS: "abc" }), ConfigError);
    assert.throws(() => loadConfig({ ...good, MXROUTE_TIMEOUT_MS: "10" }), ConfigError);
  });
});

describe("loadOptions", () => {
  it("defaults to all toolsets, writable", () => {
    const o = loadOptions({});
    assert.equal(o.readOnly, false);
    assert.equal(o.toolsets.size, 11);
  });

  it("parses MXROUTE_READ_ONLY strictly: a typo must not silently grant write access", () => {
    for (const v of ["1", "true", "TRUE", " yes ", "on"]) assert.equal(loadOptions({ MXROUTE_READ_ONLY: v }).readOnly, true, v);
    for (const v of ["", "0", "false", "No", "off"]) assert.equal(loadOptions({ MXROUTE_READ_ONLY: v }).readOnly, false, v);
    for (const v of ["ture", "enabled", "2", "readonly"]) {
      assert.throws(() => loadOptions({ MXROUTE_READ_ONLY: v }), /MXROUTE_READ_ONLY must be one of/, v);
    }
    assert.equal(loadOptions({}).readOnly, false);
  });

  it("parses a toolset list and rejects unknown names", () => {
    const o = loadOptions({ MXROUTE_TOOLSETS: " domains, Mailboxes ,spam" });
    assert.deepEqual([...o.toolsets].sort(), ["domains", "mailboxes", "spam"]);
    assert.throws(() => loadOptions({ MXROUTE_TOOLSETS: "domains,nope" }), /Unknown MXROUTE_TOOLSETS value\(s\): nope/);
    assert.throws(() => loadOptions({ MXROUTE_TOOLSETS: " , " }), ConfigError);
  });
});

describe("redact (extra)", () => {
  it("keeps an own __proto__ key as plain data and does not pollute", () => {
    const evil = JSON.parse('{"__proto__": {"polluted": "yes"}, "ok": 1}');
    const out = redact(evil);
    assert.equal(Object.getPrototypeOf(out), Object.prototype);
    assert.equal({}.polluted, undefined);
    assert.equal(out.ok, 1);
    assert.deepEqual(Object.keys(out).sort(), ["__proto__", "ok"]);
  });

  it("does not mask a bare key (the verification key is public) or words that merely contain 'pass'", () => {
    const out = redact({ key: "_da-verify-abc", bypass_count: "3", passes: "x", compass: "n", password: "p", passphrase: "q", apiKey: "k" });
    assert.deepEqual(out, { key: "_da-verify-abc", bypass_count: "3", passes: "x", compass: "n", password: "[redacted]", passphrase: "[redacted]", apiKey: "[redacted]" });
  });
});

describe("redact", () => {
  it("masks secret-looking string fields at any depth and leaves the rest alone", () => {
    const out = redact({
      email: "a@b.com",
      password: "hunter2",
      nested: [{ api_key: "k", ok: 1, token: 5 }],
    });
    assert.deepEqual(out, { email: "a@b.com", password: "[redacted]", nested: [{ api_key: "[redacted]", ok: 1, token: 5 }] });
  });
});
