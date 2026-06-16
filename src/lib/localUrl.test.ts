import { describe, expect, it } from "vitest";
import { isLocalhostUrl } from "./localUrl";

describe("isLocalhostUrl", () => {
  it("accepts localhost and loopback URLs", () => {
    expect(isLocalhostUrl("http://localhost:3000")).toBe(true);
    expect(isLocalhostUrl("https://app.localhost/path")).toBe(true);
    expect(isLocalhostUrl("http://127.0.0.1:5173")).toBe(true);
    expect(isLocalhostUrl("http://127.42.0.9")).toBe(true);
    expect(isLocalhostUrl("http://0.0.0.0:8000")).toBe(true);
    expect(isLocalhostUrl("http://[::1]:3000")).toBe(true);
  });

  it("rejects external and non-http URLs", () => {
    expect(isLocalhostUrl("https://example.com")).toBe(false);
    expect(isLocalhostUrl("http://local-host.test")).toBe(false);
    expect(isLocalhostUrl("file:///tmp/index.html")).toBe(false);
    expect(isLocalhostUrl("not a url")).toBe(false);
  });
});
