import { createServer } from "node:http";

/**
 * Starts a local stand-in for the MXroute API.
 * `handler(req, body)` returns `{ status?, headers?, json?, text? }`; every
 * request is recorded in `requests` for assertions.
 */
export async function startMockApi(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const record = { method: req.method, url: req.url, headers: req.headers, body, raw };
    requests.push(record);

    const out = (await handler(record)) ?? {};
    if (out.hang) return; // never answer (timeout tests)
    const headers = { ...(out.headers ?? {}) };
    let payload = out.text ?? "";
    if (out.json !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(out.json);
    }
    res.writeHead(out.status ?? 200, headers);
    res.end(payload);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export const CREDS = {
  server: "eagle.mxlogin.com",
  username: "johndoe",
  apiKey: "Mx_secret_key_value:with:colons",
};

export function testConfig(baseUrl, overrides = {}) {
  return { ...CREDS, baseUrl, timeoutMs: 5000, ...overrides };
}
