import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { traceEager } from "./eager-graph.mjs";

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(join(process.cwd(), ".eager-fixture-"));
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  writeFileSync(join(fixtureDir, name), content);
}

function trace(entry: string) {
  const rel = relative(process.cwd(), join(fixtureDir, `${entry}.ts`))
    .split("\\")
    .join("/");
  return traceEager(rel, ["heavy-pkg"]);
}

describe("eager graph tracer rules", () => {
  it("counts a static import of a watched package as a hit", () => {
    write("entry.ts", 'import { x } from "heavy-pkg";\nexport const v = x;\n');
    const { hits, moduleCount } = trace("entry");
    expect([...hits.keys()]).toEqual(["heavy-pkg"]);
    expect(hits.get("heavy-pkg")?.spec).toBe("heavy-pkg");
    expect(moduleCount).toBe(1);
  });

  it("ignores type-only imports", () => {
    write(
      "entry.ts",
      'import type { X } from "heavy-pkg";\nexport type T = X;\n',
    );
    const { hits } = trace("entry");
    expect(hits.size).toBe(0);
  });

  it("treats dynamic imports and lazy wrappers as lazy boundaries", () => {
    write(
      "entry.ts",
      [
        'const m = await import("heavy-pkg");',
        'const lazyLoad = () => import("heavy-pkg");',
        "void m; void lazyLoad;",
      ].join("\n"),
    );
    const { hits } = trace("entry");
    expect(hits.size).toBe(0);
  });

  it("follows relative chains but only reports watched bare packages", () => {
    write(
      "entry.ts",
      'import "./helper";\nimport "unrelated-pkg";\nexport {};',
    );
    write("helper.ts", 'import { x } from "heavy-pkg";\nexport const v = x;\n');
    const { hits, moduleCount } = trace("entry");
    expect(moduleCount).toBe(2);
    expect(hits.get("heavy-pkg")?.file).toContain("helper.ts");
  });

  it("terminates on import cycles without duplicating hits", () => {
    write("a.ts", 'import "./b";\nimport "heavy-pkg";\nexport {};\n');
    write("b.ts", 'import "./a";\nexport {};\n');
    const { hits, moduleCount } = trace("a");
    expect(moduleCount).toBe(2);
    expect(hits.size).toBe(1);
  });

  it("keeps the first pulling file for repeated packages", () => {
    write("entry.ts", 'import "heavy-pkg";\nimport "./second";\nexport {};\n');
    write("second.ts", 'import "heavy-pkg";\nexport {};\n');
    const { hits } = trace("entry");
    expect(hits.get("heavy-pkg")?.file).toContain("entry.ts");
  });
});
