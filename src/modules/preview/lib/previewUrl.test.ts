import { describe, expect, it } from "vitest";
import { loopbackPreviewOrigin } from "./previewUrl";

describe("loopbackPreviewOrigin", () => {
  it.each([
    ["http://localhost:5173/login", "http://localhost:5173"],
    ["https://app.localhost/auth", "https://app.localhost"],
    ["http://localhost.:3000", "http://localhost.:3000"],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://127.0.0.42:8080", "http://127.0.0.42:8080"],
    ["http://127.1:8080", "http://127.0.0.1:8080"],
    ["http://0.0.0.0:4173", "http://0.0.0.0:4173"],
    ["http://[::1]:3000", "http://[::1]:3000"],
  ])("returns the origin for %s", (url, origin) => {
    expect(loopbackPreviewOrigin(url)).toBe(origin);
  });

  it.each([
    "https://example.com",
    "http://192.168.1.10:3000",
    "ftp://localhost/file",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejects non-loopback or unusable URL %s", (url) => {
    expect(loopbackPreviewOrigin(url)).toBeNull();
  });
});
