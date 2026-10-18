// Removes dist/ so renamed or deleted source modules cannot linger in a build or a published package.
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

rmSync(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true, force: true });
