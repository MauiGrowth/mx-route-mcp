// Minimal, dependency-free extraction of "METHOD /path" pairs from an OpenAPI
// YAML document. Path parameter names are normalised to `{}` so that renaming
// a parameter (e.g. {user} -> {username}) does not count as drift.

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

export function normalise(path) {
  return path.replace(/\{[^}]+\}/g, "{}");
}

/** @param {string} yamlText @returns {string[]} sorted unique "METHOD /path/{}" strings */
export function extractOperations(yamlText) {
  const ops = new Set();
  let inPaths = false;
  let currentPath = null;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPaths = /^paths:\s*$/.test(line);
      currentPath = null;
      continue;
    }
    if (!inPaths) continue;
    const pathMatch = line.match(/^ {2}(\/\S*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(/^ {4}([a-z]+):\s*$/);
    if (methodMatch && currentPath && METHODS.has(methodMatch[1])) {
      ops.add(`${methodMatch[1].toUpperCase()} ${normalise(currentPath)}`);
    }
  }
  return [...ops].sort();
}
