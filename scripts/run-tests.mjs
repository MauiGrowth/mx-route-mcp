// Runs every test/*.test.mjs with the built-in test runner. Listing files
// explicitly avoids relying on glob support in `node --test`, which differs
// between Node 20 and newer releases.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../test/", import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => dir + f);

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
