import { describe, expect, it } from "vitest";
import {
  capToLineSuffix,
  reindentClosers,
  trimSuggestion,
} from "./inlineExtension";

describe("trimSuggestion", () => {
  it("drops suggestions that echo the recent prefix", () => {
    const prefix = "useEffect(() => {\n  void init();\n}, [init]);";
    expect(trimSuggestion("useEffect(() => {\n  void init();\n}, [init]);", prefix, "")).toBe("");
  });

  it("keeps genuinely new code", () => {
    const prefix = "useEffect(() => {\n  void init();\n}, [init]);\n";
    const sug = "const x = computeTotals(rows);";
    expect(trimSuggestion(sug, prefix, "")).toBe(sug);
  });

  it("starts a multi-line suggestion on a new line after a completed statement", () => {
    const prefix = "useEffect(() => {\n  void init();\n}, [init]);";
    const sug = "useEffect(() => {\n  window.focus();\n}, []);";
    expect(trimSuggestion(sug, prefix, "")).toBe(`\n${sug}`);
  });

  it("keeps single-line continuations inline after a semicolon", () => {
    expect(trimSuggestion("i < n; i++", "for (let i = 0; ", "")).toBe(
      "i < n; i++",
    );
  });

  it("strips prefix-tail token overlap", () => {
    expect(trimSuggestion("test", "#[te", "]")).toBe("st");
  });

  it("strips suffix overlap", () => {
    expect(trimSuggestion("a + b;\n}", "return ", "\n}")).toBe("a + b;");
  });

  it("moves closing brackets off a completed line", () => {
    const prefix = "      void store.prevChapter();";
    expect(trimSuggestion("}\n};", prefix, "")).toBe("\n}\n};");
  });
});

describe("capToLineSuffix", () => {
  it("keeps multi-line ghosts when the line-suffix is only closers", () => {
    const t = "(value) => {\n  log(value);\n}";
    expect(capToLineSuffix(t, ")")).toBe(t);
    expect(capToLineSuffix(t, ");")).toBe(t);
  });

  it("truncates to one line when real code follows the cursor", () => {
    expect(capToLineSuffix("x,\n  y,\n  z", " remainder + 1")).toBe("x,");
  });

  it("passes single-line ghosts through", () => {
    expect(capToLineSuffix("x + y", " * 2")).toBe("x + y");
  });
});

describe("reindentClosers", () => {
  it("dedents a closer floating at body depth", () => {
    expect(reindentClosers("\n        }\n};", "  ", "      void x();")).toBe(
      "\n    }\n  };",
    );
  });

  it("aligns a closer with its opener line", () => {
    expect(reindentClosers("() => {\n  run();\n  }", "  ", "  useEffect(")).toBe(
      "() => {\n  run();\n}",
    );
  });

  it("leaves correctly indented suggestions untouched", () => {
    const ok = "if (x) {\n  y();\n}";
    expect(reindentClosers(ok, "  ", "")).toBe(ok);
  });
});
