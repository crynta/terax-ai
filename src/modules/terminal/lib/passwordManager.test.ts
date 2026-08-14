import { describe, expect, it } from "vitest";
import {
  sanitizeTerminalPasswordEntries,
  type TerminalPasswordEntry,
} from "./passwordManager";

describe("sanitizeTerminalPasswordEntries", () => {
  it("returns an empty list for non-array payloads", () => {
    expect(sanitizeTerminalPasswordEntries(null)).toEqual([]);
    expect(sanitizeTerminalPasswordEntries({})).toEqual([]);
  });

  it("drops invalid entries and trims fields", () => {
    const out = sanitizeTerminalPasswordEntries([
      null,
      { id: "", label: "x" },
      { id: "id-1", label: "  db root  ", username: " admin ", notes: "  prod  " },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "id-1",
      label: "db root",
      username: "admin",
      notes: "prod",
    });
  });

  it("sorts entries by label", () => {
    const out = sanitizeTerminalPasswordEntries([
      { id: "2", label: "zeta" },
      { id: "1", label: "alpha" },
    ]);
    expect(out.map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("fills missing timestamps", () => {
    const out = sanitizeTerminalPasswordEntries([{ id: "x", label: "one" }]);
    const entry = out[0] as TerminalPasswordEntry;
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeGreaterThan(0);
  });
});
