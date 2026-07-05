import { describe, expect, it } from "vitest";
import { resolveDisplayName } from "./languageResolver";

describe("resolveDisplayName", () => {
  it("resolves real extensions", () => {
    expect(resolveDisplayName("App.tsx")).toBe("TypeScript React");
    expect(resolveDisplayName("main.go")).toBe("Go");
    expect(resolveDisplayName("README.md")).toBe("Markdown");
    expect(resolveDisplayName("query.sql")).toBe("SQL");
  });

  it("strips directories before resolving", () => {
    expect(resolveDisplayName("/Users/foo/src/index.ts")).toBe("TypeScript");
    expect(resolveDisplayName("C:\\proj\\Dockerfile.prod")).toBe("Dockerfile");
  });

  it("matches fixed filenames", () => {
    expect(resolveDisplayName("Dockerfile")).toBe("Dockerfile");
    expect(resolveDisplayName(".env")).toBe("Properties");
    expect(resolveDisplayName(".eslintrc")).toBe("JSON");
  });

  // Regression: removing isDockerfileLike dropped highlighting for Dockerfile
  // variants. The name-scoped prefix fallback restores it generically.
  it("resolves filename-prefix variants of name-based languages", () => {
    expect(resolveDisplayName("Dockerfile.web")).toBe("Dockerfile");
    expect(resolveDisplayName("Dockerfile.dev")).toBe("Dockerfile");
    expect(resolveDisplayName("web.dockerfile")).toBe("Dockerfile");
  });

  // The prefix fallback must not let extension languages capture lookalike
  // files: `go.sum` / `go.mod` are not Go, `json.backup` is not JSON.
  it("does not let extension languages capture prefix lookalikes", () => {
    expect(resolveDisplayName("go.sum")).not.toBe("Go");
    expect(resolveDisplayName("go.mod")).not.toBe("Go");
    expect(resolveDisplayName("json.backup")).not.toBe("JSON");
  });

  it("falls back to a capitalized basename for unknown files", () => {
    expect(resolveDisplayName("notes")).toBe("Notes");
    expect(resolveDisplayName(null)).toBe("Plain Text");
    expect(resolveDisplayName("")).toBe("Plain Text");
  });
});
