import { rmSync } from "node:fs";
import path from "node:path";

// A fixed checkout-local fixture directory, never the user's projects/data.
rmSync(path.resolve(import.meta.dirname, "../e2e/.data"), { recursive: true, force: true });
await import("./make-samples.ts");
await import("../server/index.ts");
