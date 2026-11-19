import type { Tab } from "@/modules/tabs/lib/tabs";
import { describe, expect, it } from "vitest";
import { resolveControlContext } from "./context";

const tabs: Tab[] = [
  {
    id: 12,
    kind: "terminal",
    spaceId: "agent-space",
    title: "agent",
  },
  {
    id: 13,
    kind: "terminal",
    spaceId: "agent-space",
    title: "agent",
  },
  {
    id: 20,
    kind: "editor",
    spaceId: "active-space",
    title: "main.rs",
    path: "/workspace/main.rs",
    dirty: false,
    preview: false,
  },
];

describe("resolveControlContext", () => {
  it("targets the calling pane instead of ambient UI focus", () => {
    expect(resolveControlContext(tabs, 20, "active-space", 13)).toEqual({
      window_id: "main",
      space_id: "agent-space",
      tab_id: 13,
      pane_id: 13,
      source: "caller",
    });
  });

  it("falls back to the active context for an external CLI", () => {
    expect(resolveControlContext(tabs, 20, "active-space")).toEqual({
      window_id: "main",
      space_id: "active-space",
      tab_id: 20,
      pane_id: null,
      source: "active",
    });
  });

  it("does not trust a stale caller pane id", () => {
    expect(resolveControlContext(tabs, 20, "active-space", 999).source).toBe(
      "active",
    );
  });
});
