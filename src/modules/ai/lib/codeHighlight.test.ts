import { highlight } from "@/components/ai-elements/chat-code-lezer";
import { describe, expect, it } from "vitest";

describe("chat code highlighting", () => {
  it.each(["js", "javascript", "ts", "typescript", "jsx", "tsx"])(
    "highlights %s keywords, strings and comments and preserves source text",
    async (language) => {
      const code = 'const answer = "hello";\n// comment';
      const nodes = await highlight(code, language);
      expect(nodes).not.toBeNull();
      if (!nodes) throw new Error(`Missing language for ${language}`);

      const tokens = nodes.filter((node) => node.kind === "text");
      const classesFor = (value: string) =>
        tokens.find((node) => node.value === value)?.cls.split(" ");
      expect(classesFor("const")).toContain("tok-keyword");
      expect(classesFor('"hello"')).toContain("tok-string");
      expect(classesFor("// comment")).toContain("tok-comment");
      expect(
        nodes
          .map((node) => (node.kind === "break" ? "\n" : node.value))
          .join(""),
      ).toBe(code);
    },
  );
});
