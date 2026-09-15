import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/ghostty-profile.ts"],
    testTimeout: 180_000,
    fileParallelism: false,
  },
});
