import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: { "@": path.resolve(root, "../../src") } },
  define: {
    __TERAX_IPC_BASE_URL__: JSON.stringify(process.env.TERAX_IPC_BASE_URL),
    __TERAX_IPC_TREE__: JSON.stringify(process.env.TERAX_IPC_TREE),
  },
  build: {
    target: "es2022",
    outDir: process.env.TERAX_IPC_DIST,
    emptyOutDir: true,
  },
});
