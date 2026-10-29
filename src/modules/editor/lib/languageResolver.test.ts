import { highlightingFor, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { resolveDisplayName, resolveLanguage } from "./languageResolver";
import { EDITOR_THEME_EXT } from "./themes";

describe("resolveDisplayName", () => {
  it.each(["/project/script.luau", "C:\\project\\SCRIPT.LUAU"])(
    "loads Luau highlighting without changing its LSP identity: %s",
    async (path) => {
      expect(resolveDisplayName(path)).toBe("Luau");
      const result = await resolveLanguage(path);
      if (!result) throw new Error("Luau language failed to load");
      expect(result.id).toBe("luau");
      const code = 'local message = "hello" -- comment';
      const state = EditorState.create({
        doc: code,
        extensions: [result.ext, EDITOR_THEME_EXT.atomone],
      });
      const highlighted: string[] = [];
      highlightTree(
        syntaxTree(state),
        { style: (tags) => highlightingFor(state, tags) },
        (from, to) => highlighted.push(code.slice(from, to)),
      );
      expect(highlighted).toContain("local");
      expect(highlighted).toContain('"hello"');
      expect(highlighted).toContain("-- comment");
      expect((await resolveLanguage("script.lua"))?.id).toBe("lua");
    },
  );

  it("resolves real extensions", () => {
    expect(resolveDisplayName("App.tsx")).toBe("TypeScript React");
    expect(resolveDisplayName("main.go")).toBe("Go");
    expect(resolveDisplayName("README.md")).toBe("Markdown");
    expect(resolveDisplayName("query.sql")).toBe("SQL");
    expect(resolveDisplayName("Component.svelte")).toBe("Svelte");
  });

  it("strips directories before resolving", () => {
    expect(resolveDisplayName("/Users/foo/src/index.ts")).toBe("TypeScript");
    expect(resolveDisplayName("C:\\proj\\Dockerfile.prod")).toBe("Dockerfile");
  });

  it("matches fixed filenames", () => {
    expect(resolveDisplayName("Dockerfile")).toBe("Dockerfile");
    expect(resolveDisplayName(".env")).toBe("Dotenv");
    expect(resolveDisplayName(".eslintrc")).toBe("JSON");
  });

  // Regression: removing isDockerfileLike dropped highlighting for Dockerfile
  // variants. The name-scoped prefix fallback restores it generically.
  it("resolves filename-prefix variants of name-based languages", () => {
    expect(resolveDisplayName("Dockerfile.web")).toBe("Dockerfile");
    expect(resolveDisplayName("Dockerfile.dev")).toBe("Dockerfile");
    expect(resolveDisplayName("web.dockerfile")).toBe("Dockerfile");
    expect(resolveDisplayName(".env.local")).toBe("Dotenv");
    expect(resolveDisplayName(".env.production.local")).toBe("Dotenv");
    expect(resolveDisplayName("example.env")).toBe("Dotenv");
  });

  it("loads dotenv files with their language mode", async () => {
    const result = await resolveLanguage("/project/.env.local");
    expect(result?.name).toBe("Dotenv");
    expect(result?.id).toBe("env");
    expect(result?.ext).toBeTruthy();
  });

  // `.svelte` used to resolve to HTML, which left blocks and directives as
  // plain text and made the svelte-ls preset unreachable (langId drives both).
  it("loads Svelte files with their dedicated language mode", async () => {
    const result = await resolveLanguage("/project/Component.svelte");
    if (!result) throw new Error("Svelte language failed to load");

    expect(result.name).toBe("Svelte");
    expect(result.id).toBe("svelte");

    const state = EditorState.create({
      doc: "{#if ready}<button on:click={run}>{label}</button>{/if}",
      extensions: [result.ext],
    });
    const tree = syntaxTree(state).toString();
    expect(tree).toContain("IfBlock");
    expect(tree).toContain("DirectiveOn");
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

describe("JavaScript and TypeScript highlighting", () => {
  const cases = [
    { ext: "js", code: 'const answer = "hello"; // comment' },
    { ext: "cjs", code: 'const answer = "hello"; // comment' },
    { ext: "mjs", code: 'const answer = "hello"; // comment' },
    { ext: "ts", code: 'const answer: string = "hello"; // comment' },
    { ext: "cts", code: 'const answer: string = "hello"; // comment' },
    { ext: "mts", code: 'const answer: string = "hello"; // comment' },
    {
      ext: "jsx",
      code: 'const App = () => <div title="hello" />; // comment',
    },
    {
      ext: "tsx",
      code: 'const App = (name: string) => <div title="hello" />; // comment',
    },
  ];

  for (const [theme, themeExt] of Object.entries(EDITOR_THEME_EXT)) {
    it.each(cases)(
      `highlights $ext tokens with ${theme}`,
      async ({ ext, code }) => {
        const result = await resolveLanguage(`/project/file.${ext}`);
        expect(result).not.toBeNull();
        if (!result) throw new Error(`Missing language for ${ext}`);

        const state = EditorState.create({
          doc: code,
          extensions: [result.ext, themeExt],
        });
        const spans: { from: number; to: number; classes: string }[] = [];
        highlightTree(
          syntaxTree(state),
          { style: (tags) => highlightingFor(state, tags) },
          (from, to, classes) => spans.push({ from, to, classes }),
        );

        const styleAt = (token: string): string | undefined => {
          const pos = code.indexOf(token);
          return spans.find((span) => span.from <= pos && span.to > pos)
            ?.classes;
        };
        expect(styleAt("const")).toBeTruthy();
        expect(styleAt('"hello"')).toBeTruthy();
        expect(styleAt("// comment")).toBeTruthy();
        expect(styleAt("const")).not.toBe(styleAt('"hello"'));
        if (ext.endsWith("x")) expect(styleAt("div")).toBeTruthy();
        if (code.includes(": string")) {
          expect(syntaxTree(state).toString()).toContain("TypeAnnotation");
        }
      },
    );
  }
});
