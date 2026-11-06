import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//u, replacement: `${path.resolve(import.meta.dirname, "../src")}/` }],
  },
  test: {
    root: import.meta.dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
