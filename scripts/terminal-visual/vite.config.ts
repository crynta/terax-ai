import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const source = process.env.TERAX_VISUAL_SOURCE_ROOT ?? path.resolve(root, "../..");
const outDir = process.env.TERAX_VISUAL_OUT;

// Receives raw RGBA readbacks from the page so they can be compared offline.
function saveEndpoint(): Plugin {
  return {
    name: "terax-visual-save",
    configureServer(server) {
      server.middlewares.use("/__save", (request, response) => {
        if (!outDir || request.method !== "POST") {
          response.statusCode = 400;
          response.end();
          return;
        }
        const name = path.basename(new URL(request.url ?? "", "http://x").pathname);
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, name), Buffer.concat(chunks));
          response.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  root,
  cacheDir: path.join(
    os.tmpdir(),
    `terax-visual-vite-${process.env.TERAX_VISUAL_PORT ?? 5199}`,
  ),
  plugins: [saveEndpoint()],
  server: {
    port: Number(process.env.TERAX_VISUAL_PORT ?? 5199),
    strictPort: true,
    fs: { allow: [root, source, path.resolve(root, "../..")] },
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.join(source, "src") },
      {
        find: "@terax/ghostty-core/adapted",
        replacement: path.join(source, "packages/ghostty-core/lib/adapted/index.ts"),
      },
      {
        find: "@terax/ghostty-core/protocol",
        replacement: path.join(source, "packages/ghostty-core/lib/protocol.ts"),
      },
    ],
  },
  // Product code gates app-lab hooks on this build-time constant (see the app's vite.config.ts).
  define: { __TERAX_BENCH__: "false" },
  build: { target: "es2022" },
});
