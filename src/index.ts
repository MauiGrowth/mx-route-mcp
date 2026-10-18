#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MxrouteClient } from "./client.js";
import { ConfigError, loadConfig, loadOptions } from "./config.js";
import { createServer, describeError } from "./server.js";
import { ALL_TOOLS, selectTools, TOOLSETS } from "./tools/index.js";
import { VERSION } from "./version.js";

const HELP = `mx-route-mcp ${VERSION}
Model Context Protocol server for the MXroute email hosting API (stdio transport).

Usage:
  mx-route-mcp             Start the MCP server on stdin/stdout
  mx-route-mcp --check     Verify credentials by listing domains, then exit
  mx-route-mcp --tools     Print the tools that would be registered, then exit
  mx-route-mcp --version   Print the version
  mx-route-mcp --help      Show this help

Environment:
  MXROUTE_SERVER       Mail server hostname, e.g. eagle.mxlogin.com            (required)
  MXROUTE_USERNAME     DirectAdmin username, or "reseller|user" to act as user (required)
  MXROUTE_API_KEY      API key from https://panel.mxroute.com/api-keys.php     (required)
  MXROUTE_READ_ONLY    true|false (also 1/0, yes/no, on/off); true registers only
                       read-only tools. Default false. Other values are an error.
  MXROUTE_TOOLSETS     Comma-separated subset of: ${TOOLSETS.join(", ")}
                       Default: all
  MXROUTE_TIMEOUT_MS   Per-request timeout, 1000-300000, default 30000
  MXROUTE_API_URL      Override API origin (testing only; https, or http on localhost)

--tools and --check read the same variables, so run them with the values from your
client config, e.g.  MXROUTE_READ_ONLY=true mx-route-mcp --tools
`;

// stdout carries the MCP protocol, so all diagnostics go to stderr.
function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

// If the host goes away while we are writing, exit quietly instead of dying with
// an unhandled 'error' event (EPIPE).
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  process.exit(err.code === "EPIPE" ? 0 : 1);
});

async function main(argv: string[]): Promise<number> {
  const flag = argv[0];
  if (argv.length > 1) {
    log(`Unexpected extra arguments.\n\n${HELP}`);
    return 2;
  }

  if (flag === "--help" || flag === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (flag === "--version" || flag === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flag !== undefined && flag !== "--check" && flag !== "--tools") {
    log(`Unknown argument.\n\n${HELP}`);
    return 2;
  }

  const options = loadOptions();

  if (flag === "--tools") {
    const tools = selectTools(options);
    for (const t of tools) {
      const kind = t.readOnly ? "read" : t.destructive ? "write (destructive)" : "write";
      process.stdout.write(`${t.name.padEnd(32)} ${kind}\n`);
    }
    process.stdout.write(`\n${tools.length} of ${ALL_TOOLS.length} tools enabled\n`);
    return 0;
  }

  if (flag === "--check") {
    const config = loadConfig();
    const domains = await new MxrouteClient(config).request("GET", "/domains");
    if (!Array.isArray(domains)) {
      log("The MXroute API answered, but not with a list of domains. Check MXROUTE_API_URL.");
      return 1;
    }
    const count = domains.length;
    process.stdout.write(
      `OK: authenticated to ${config.server} as ${config.username}; ${count} domain${count === 1 ? "" : "s"} found.\n`,
    );
    return 0;
  }

  // Credentials are validated lazily, on the first tool call, so that the
  // server can start and list its tools even before they are configured.
  let client: MxrouteClient | undefined;
  const server = createServer({
    options,
    getClient: () => (client ??= new MxrouteClient(loadConfig())),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`mx-route-mcp ${VERSION} running on stdio (${selectTools(options).length} tools)`);

  // Resolve only when stdin closes so the process exits with the host.
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
  });
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log(err instanceof ConfigError ? `Configuration error: ${err.message}` : describeError(err));
    process.exitCode = 1;
  },
);
