import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MxrouteClient, MxrouteError, ToolInputError, buildPath, sanitizeMessage } from "../dist/client.js";
import { CREDS, startMockApi, testConfig } from "./helpers/mock-api.mjs";

const open = [];
async function mock(handler) {
  const api = await startMockApi(handler);
  open.push(api);
  return api;
}
afterEach(async () => {
  while (open.length) await open.pop().close();
});

describe("buildPath", () => {
  it("substitutes and URL-encodes every segment", () => {
    assert.equal(
      buildPath("/domains/{domain}/spam/whitelist/{entry}", { domain: "example.com", entry: "*@trusted.com" }),
      "/domains/example.com/spam/whitelist/*%40trusted.com",
    );
    assert.equal(buildPath("/a/{x}", { x: "a/b c?d#e" }), "/a/a%2Fb%20c%3Fd%23e");
  });

  it("rejects missing, empty and non-string parameters", () => {
    assert.throws(() => buildPath("/a/{x}", {}), ToolInputError);
    assert.throws(() => buildPath("/a/{x}", { x: "" }), ToolInputError);
    assert.throws(() => buildPath("/a/{x}", { x: 5 }), ToolInputError);
  });

  it("reports lone surrogates as an input error instead of throwing URIError", () => {
    assert.throws(() => buildPath("/a/{x}", { x: "a\ud800b" }), ToolInputError);
  });

  it("rejects dot segments and control characters (path traversal)", () => {
    assert.throws(() => buildPath("/domains/{domain}", { domain: ".." }), ToolInputError);
    assert.throws(() => buildPath("/domains/{domain}", { domain: "." }), ToolInputError);
    assert.throws(() => buildPath("/domains/{domain}", { domain: "a\nb" }), ToolInputError);
  });
});

describe("MxrouteClient.request", () => {
  it("sends the three auth headers, accept and user-agent, and unwraps {success,data}", async () => {
    const api = await mock(() => ({ json: { success: true, data: ["example.com"] } }));
    const client = new MxrouteClient(testConfig(api.url));
    const data = await client.request("GET", "/domains");
    assert.deepEqual(data, ["example.com"]);

    const [req] = api.requests;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/domains");
    assert.equal(req.headers["x-server"], CREDS.server);
    assert.equal(req.headers["x-username"], CREDS.username);
    assert.equal(req.headers["x-api-key"], CREDS.apiKey); // colons preserved, nothing prepended
    assert.equal(req.headers["accept"], "application/json");
    assert.match(req.headers["user-agent"], /^mx-route-mcp\//);
    assert.equal(req.headers["content-type"], undefined);
  });

  it("sends JSON bodies with a content-type", async () => {
    const api = await mock(() => ({ status: 201, json: { success: true, data: { domain: "example.com" } } }));
    const client = new MxrouteClient(testConfig(api.url));
    const data = await client.request("POST", "/domains", { body: { domain: "example.com" } });
    assert.deepEqual(data, { domain: "example.com" });
    assert.equal(api.requests[0].headers["content-type"], "application/json");
    assert.deepEqual(api.requests[0].body, { domain: "example.com" });
  });

  it("returns null for 204 No Content without trying to parse JSON", async () => {
    const api = await mock(() => ({ status: 204 }));
    const client = new MxrouteClient(testConfig(api.url));
    assert.equal(await client.request("DELETE", "/domains/example.com"), null);
  });

  it("returns un-enveloped bodies (e.g. /quota) as-is", async () => {
    const quota = { username: "johndoe", total_used: 10, total_limit: 0, percent_used: 0 };
    const api = await mock(() => ({ json: quota }));
    const client = new MxrouteClient(testConfig(api.url));
    assert.deepEqual(await client.request("GET", "/quota"), quota);
  });

  it("returns remaining fields when success:true has no data", async () => {
    const api = await mock(() => ({ json: { success: true, message: "Updated" } }));
    const client = new MxrouteClient(testConfig(api.url));
    assert.deepEqual(await client.request("PATCH", "/x", { body: {} }), { message: "Updated" });
  });

  it("maps the documented error envelope to MxrouteError (code, message, field)", async () => {
    const api = await mock(() => ({
      status: 400,
      json: { success: false, error: { code: "VALIDATION_ERROR", message: "Password too weak", field: "password" } },
    }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("POST", "/x", { body: {} }), (err) => {
      assert.ok(err instanceof MxrouteError);
      assert.equal(err.status, 400);
      assert.equal(err.code, "VALIDATION_ERROR");
      assert.equal(err.message, "Password too weak");
      assert.equal(err.field, "password");
      return true;
    });
  });

  it("falls back to the status line when an error body is not JSON (e.g. an HTML 404)", async () => {
    const api = await mock(() => ({ status: 404, text: "<html><body>Not Found</body></html>" }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("GET", "/nope"), (err) => {
      assert.ok(err instanceof MxrouteError);
      assert.equal(err.status, 404);
      assert.equal(err.code, "HTTP_404");
      assert.ok(!err.message.includes("<html>"));
      return true;
    });
  });

  it("surfaces Retry-After and X-RateLimit-Reset on 429", async () => {
    const api = await mock(() => ({
      status: 429,
      headers: { "retry-after": "17", "x-ratelimit-reset": "1893456000" },
      json: { success: false, error: { code: "RATE_LIMITED", message: "Too many requests." } },
    }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("GET", "/domains"), (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.code, "RATE_LIMITED");
      assert.equal(err.retryAfter, 17);
      assert.equal(err.rateLimitReset, 1893456000);
      return true;
    });
  });

  it("treats HTTP 200 with success:false as an error", async () => {
    const api = await mock(() => ({ json: { success: false, error: { code: "BUSINESS_ERROR", message: "Limit reached" } } }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("POST", "/x", { body: {} }), (err) => err.code === "BUSINESS_ERROR");
  });

  it("rejects non-JSON success responses (misconfigured proxy / base URL)", async () => {
    const api = await mock(() => ({ status: 200, text: "<html>hello</html>" }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("GET", "/domains"), (err) => err.code === "INVALID_RESPONSE");
  });

  it("does not follow redirects, so credentials cannot be forwarded to another host", async () => {
    const other = await mock(() => ({ json: { success: true, data: "leaked" } }));
    const api = await mock(() => ({ status: 302, headers: { location: `${other.url}/domains` } }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("GET", "/domains"), (err) => err.code === "REDIRECT");
    assert.equal(other.requests.length, 0);
  });

  it("times out with a clear error; only writes warn that the outcome is unknown", async () => {
    const api = await mock(() => ({ hang: true }));
    const client = new MxrouteClient(testConfig(api.url, { timeoutMs: 100 }));
    await assert.rejects(client.request("GET", "/domains"), (err) => {
      assert.equal(err.code, "TIMEOUT");
      assert.ok(!/may or may not/.test(err.message));
      return true;
    });
    await assert.rejects(client.request("POST", "/domains", { body: { domain: "a.com" } }), (err) => {
      assert.equal(err.code, "TIMEOUT");
      assert.match(err.message, /may or may not have been applied/);
      return true;
    });
    await assert.rejects(client.request("DELETE", "/domains/a.com"), (err) => /may or may not/.test(err.message));
  });

  it("warns about unknown outcome on a connection failure during a write", async () => {
    const client = new MxrouteClient(testConfig("http://127.0.0.1:9"));
    await assert.rejects(client.request("DELETE", "/domains/a.com"), (err) => err.code === "NETWORK_ERROR" && /may or may not/.test(err.message));
  });

  it("bounds and flattens API-supplied error text", async () => {
    const api = await mock(() => ({ status: 500, json: { success: false, error: { code: "SERVER_ERROR", message: "x".repeat(5000) + "\nsecond line" } } }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("GET", "/domains"), (err) => {
      assert.ok(err.message.length <= 501);
      assert.ok(!err.message.includes("\n"));
      return true;
    });
    assert.equal(sanitizeMessage("a\r\nb\u0000c"), "a b c");
  });

  it("parses Retry-After as seconds or as an HTTP date, and ignores junk", async () => {
    const when = new Date(Date.now() + 90_000).toUTCString();
    for (const [value, check] of [["30", (n) => n === 30], [when, (n) => n >= 88 && n <= 91], ["soon", (n) => n === undefined], ["-5", (n) => n === undefined], ["0x10", (n) => n === undefined]]) {
      const api = await mock(() => ({ status: 429, headers: { "retry-after": value }, json: { success: false, error: { code: "RATE_LIMITED", message: "slow down" } } }));
      const client = new MxrouteClient(testConfig(api.url));
      await assert.rejects(client.request("GET", "/domains"), (err) => {
        assert.ok(check(err.retryAfter), `${value} -> ${err.retryAfter}`);
        return true;
      });
    }
  });

  it("reports network failures without echoing the URL or credentials", async () => {
    const client = new MxrouteClient(testConfig("http://127.0.0.1:9"));
    await assert.rejects(client.request("GET", "/domains"), (err) => {
      assert.equal(err.code, "NETWORK_ERROR");
      assert.ok(!err.message.includes(CREDS.apiKey));
      return true;
    });
  });

  it("never includes the API key in any error message", async () => {
    const api = await mock(() => ({ status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "Invalid API credentials" } } }));
    const client = new MxrouteClient(testConfig(api.url));
    await assert.rejects(client.request("GET", "/domains"), (err) => {
      assert.ok(!JSON.stringify(err).includes(CREDS.apiKey));
      assert.ok(!String(err.stack).includes(CREDS.apiKey));
      return true;
    });
  });
});
