import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("serves the development app with an enforced frame-ancestors header", async () => {
  const server = await createServer({
    configFile: fileURLToPath(new URL("../../../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      hmr: false,
      watch: null,
    },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("missing HTTP address");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  } finally {
    await server.close();
  }
});
