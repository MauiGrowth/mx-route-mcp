// Makes the compiled CLI entry executable so `npx mx-route-mcp` works on POSIX.
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
try {
  chmodSync(entry, 0o755);
} catch (err) {
  console.error(`postbuild: could not chmod ${entry}: ${err.message}`);
  process.exit(1);
}
