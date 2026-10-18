// Regenerates the tools table in README.md from the compiled tool definitions,
// so the documentation cannot drift from the code.
// Usage: node scripts/gen-readme-tools.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALL_TOOLS, TOOLSETS } from "../dist/tools/index.js";

const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

const TITLES = {
  account: "Account",
  domains: "Domains",
  pointers: "Domain pointers",
  mailboxes: "Email accounts",
  forwarders: "Forwarders",
  spam: "Spam filtering",
  dns: "DNS",
  catchall: "Catch-all",
  quota: "Quota",
  reseller_users: "Reseller: users",
  reseller_packages: "Reseller: packages",
};

function firstSentence(text) {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : text).replace(/\|/g, "\\|");
}

function kind(t) {
  return t.readOnly ? "read" : t.destructive ? "**destructive**" : "write";
}

let out = "";
for (const set of TOOLSETS) {
  const tools = ALL_TOOLS.filter((t) => t.toolset === set);
  if (!tools.length) continue;
  out += `\n**${TITLES[set]}** — toolset \`${set}\`\n\n| Tool | Type | API call | Description |\n| --- | --- | --- | --- |\n`;
  for (const t of tools) {
    const [method, path] = t.operation.split(" ");
    out += `| \`${t.name}\` | ${kind(t)} | \`${method} ${path}\` | ${firstSentence(t.description)} |\n`;
  }
}

const readme = readFileSync(readmePath, "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) {
  console.error("README.md is missing the tools:start/tools:end markers");
  process.exit(2);
}
const next = readme.slice(0, start + START.length) + "\n" + out + "\n" + readme.slice(end);
if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README.md tools table is out of date. Run: npm run docs:tools");
    process.exit(1);
  }
  console.log("README.md tools table is up to date");
} else {
  writeFileSync(readmePath, next);
  console.log(`README.md updated (${ALL_TOOLS.length} tools)`);
}
