import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "../../src"),
      // driver-new.ts targets the multiplexed stream, driver-old.ts the
      // per-terminal channels of the previous transport.
      "@smoke-driver": path.resolve(root, process.env.TERAX_SMOKE_DRIVER ?? "driver-new.ts"),
    },
  },
  define: {
    __SMOKE_BASE_URL__: JSON.stringify(process.env.TERAX_SMOKE_BASE_URL),
    __SMOKE_IDLE_MS__: JSON.stringify(Number(process.env.TERAX_SMOKE_IDLE_MS ?? 35000)),
    __SMOKE_FAST__: JSON.stringify(process.env.TERAX_SMOKE_FAST === "1"),
    __SMOKE_ONLY__: JSON.stringify(process.env.TERAX_SMOKE_ONLY ?? ""),
    __SMOKE_SPIN_SECONDS__: JSON.stringify(Number(process.env.TERAX_SMOKE_SPIN_SECONDS ?? 5)),
  },
  build: {
    target: "es2022",
    outDir: process.env.TERAX_SMOKE_DIST,
    emptyOutDir: true,
  },
});
