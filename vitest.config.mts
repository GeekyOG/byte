import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@byte/pet": path.resolve(import.meta.dirname, "packages/pet/src/index.ts"),
      "@byte/signals": path.resolve(import.meta.dirname, "packages/signals/src/index.ts"),
      "@byte/design-guard": path.resolve(import.meta.dirname, "plugins/design-guard/src/index.ts"),
      "@byte/audit": path.resolve(import.meta.dirname, "plugins/audit/src/index.ts"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts", "plugins/*/test/**/*.test.ts"] },
});
