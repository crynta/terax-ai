import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type StoreChange = (key: string, value: unknown) => void;
  type EventChange = (event: { payload: { key: string; value: unknown } }) => void;

  const storeChanges: StoreChange[] = [];
  const eventChanges = new Map<string, EventChange>();

  class MockLazyStore {
    entries = vi.fn(async () => []);
    set = vi.fn(async () => {});
    save = vi.fn(async () => {});
    onChange = vi.fn(async (callback: StoreChange) => {
      storeChanges.push(callback);
      return () => {
        const index = storeChanges.indexOf(callback);
        if (index >= 0) storeChanges.splice(index, 1);
      };
    });
  }

  return { eventChanges, MockLazyStore, storeChanges };
});

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: mocks.MockLazyStore,
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(async (event: string, callback: unknown) => {
    mocks.eventChanges.set(event, callback as never);
    return () => {
      mocks.eventChanges.delete(event);
    };
  }),
}));

import { onPreferencesChange } from "./store";

describe("onPreferencesChange", () => {
  beforeEach(() => {
    mocks.eventChanges.clear();
    mocks.storeChanges.length = 0;
  });

  it("maps pi auth mode changes from store notifications", async () => {
    const changes: Array<[string, unknown]> = [];
    const unlisten = await onPreferencesChange((key, value) => {
      changes.push([key, value]);
    });

    mocks.storeChanges[0]?.("piAuthMode", "profile");

    expect(changes).toEqual([["piAuthMode", "profile"]]);
    unlisten();
  });

  it("maps pi auth mode changes from cross-window preference events", async () => {
    const changes: Array<[string, unknown]> = [];
    const unlisten = await onPreferencesChange((key, value) => {
      changes.push([key, value]);
    });

    mocks.eventChanges.get("terax://prefs-changed")?.({
      payload: { key: "piAuthMode", value: "profile" },
    });

    expect(changes).toEqual([["piAuthMode", "profile"]]);
    unlisten();
  });
});
