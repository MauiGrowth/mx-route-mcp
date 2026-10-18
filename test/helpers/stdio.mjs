import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ENTRY = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

/** Spawns the built server over stdio and connects an MCP client to it. */
export async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    // The SDK only forwards a safe default env plus what we pass, so the
    // developer's real MXROUTE_* variables can never leak into tests.
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({ name: "mx-route-mcp-tests", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    get stderr() {
      return stderr;
    },
    async close() {
      await client.close();
    },
  };
}

/** First text block of a tool result. */
export function textOf(result) {
  const block = result.content.find((c) => c.type === "text");
  return block ? block.text : "";
}
