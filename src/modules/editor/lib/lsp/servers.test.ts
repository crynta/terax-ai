import { describe, expect, it } from "vitest";
import { resolveLspServer, resolveLspServerSpecs } from "./servers";

describe("resolveLspServer", () => {
  it("maps TypeScript files", () => {
    expect(resolveLspServer("/proj/foo.ts")?.languageId).toBe("typescript");
    expect(resolveLspServer("/proj/foo.tsx")?.languageId).toBe(
      "typescriptreact",
    );
    expect(resolveLspServer("/proj/foo.js")?.languageId).toBe("javascript");
  });

  it("maps Rust files", () => {
    expect(resolveLspServer("/proj/lib.rs")?.command).toBe("rust-analyzer");
  });

  it("maps PHP files to intelephense", () => {
    expect(resolveLspServer("/proj/index.php")?.command).toBe("intelephense");
    expect(resolveLspServer("/proj/index.php")?.languageId).toBe("php");
    expect(resolveLspServer("/proj/view.phtml")?.command).toBe("intelephense");
  });

  it("maps package.json to deps-lsp plus JSON schema server", () => {
    const specs = resolveLspServerSpecs("/proj/package.json");
    expect(specs.map((s) => s.command)).toEqual([
      "deps-lsp",
      "vscode-json-language-server",
    ]);
    expect(specs[0]?.languageId).toBe("json");
    expect(resolveLspServer("/proj/package-lock.json")?.languageId).toBe(
      "json",
    );
  });

  it("maps Cargo.toml to deps-lsp", () => {
    expect(resolveLspServer("/proj/Cargo.toml")?.command).toBe("deps-lsp");
    expect(resolveLspServer("/proj/Cargo.toml")?.languageId).toBe("toml");
  });

  it("maps tsconfig and vscode json to jsonc", () => {
    expect(resolveLspServer("/proj/tsconfig.json")?.languageId).toBe("jsonc");
    expect(resolveLspServer("/proj/tsconfig.app.json")?.languageId).toBe(
      "jsonc",
    );
    expect(
      resolveLspServer("/proj/.vscode/settings.json")?.languageId,
    ).toBe("jsonc");
  });

  it("maps extensionless dotfiles often written as JSON", () => {
    expect(resolveLspServer("/proj/.prettierrc")?.languageId).toBe("json");
    expect(resolveLspServer("/proj/.babelrc")?.command).toBe(
      "vscode-json-language-server",
    );
  });

  it("returns null for unsupported extensions", () => {
    expect(resolveLspServer("/proj/readme.md")).toBeNull();
  });
});
