// Compares the live MXroute OpenAPI document against (a) the recorded operation
// list in spec/operations.json and (b) the tools this package registers.
// Usage: node scripts/check-spec.mjs [--write]
//   --write   refresh spec/operations.json from the live document
// Exits 1 if the API has operations that no tool covers, or tools target
// operations the API no longer lists.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extractOperations, normalise } from "./lib/openapi.mjs";

const SPEC_URL = process.env.MXROUTE_SPEC_URL ?? "https://api.mxroute.com/openapi.yaml";
const recordedPath = fileURLToPath(new URL("../spec/operations.json", import.meta.url));

const res = await fetch(SPEC_URL);
if (!res.ok) {
  console.error(`Could not fetch ${SPEC_URL}: HTTP ${res.status}`);
  process.exit(2);
}
const live = extractOperations(await res.text());

const { ALL_TOOLS } = await import("../dist/tools/index.js");
const covered = new Set(
  ALL_TOOLS.map((t) => {
    const [method, path] = t.operation.split(" ");
    return `${method} ${normalise(path)}`;
  }),
);

const recorded = JSON.parse(readFileSync(recordedPath, "utf8")).operations;
const newInApi = live.filter((op) => !recorded.includes(op));
const removedFromApi = recorded.filter((op) => !live.includes(op));
const uncovered = live.filter((op) => !covered.has(op));
const stale = [...covered].filter((op) => !live.includes(op));

console.log(`live operations: ${live.length}, tools: ${ALL_TOOLS.length}`);
if (newInApi.length) console.log("new in API since last record:\n  " + newInApi.join("\n  "));
if (removedFromApi.length) console.log("removed from API since last record:\n  " + removedFromApi.join("\n  "));
if (uncovered.length) console.log("API operations with no tool:\n  " + uncovered.join("\n  "));
if (stale.length) console.log("tools targeting operations the API no longer lists:\n  " + stale.join("\n  "));

if (process.argv.includes("--write")) {
  writeFileSync(recordedPath, JSON.stringify({ source: SPEC_URL, operations: live }, null, 2) + "\n");
  console.log(`wrote ${recordedPath}`);
}
process.exit(uncovered.length || stale.length ? 1 : 0);
