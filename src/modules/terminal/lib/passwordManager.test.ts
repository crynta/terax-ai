import { beforeEach, describe, expect, it, vi } from "vitest";

type StoreData = Record<string, unknown>;

const storeData: StoreData = {};
const keychain = new Map<string, string>();

let failNextGet = false;
let failNextSave = false;

const invokeMock = vi.fn(
  async (
    command: string,
    args: { account?: string; password?: string } = {},
  ) => {
    const account = args.account ?? "";
    if (command === "secrets_set") {
      keychain.set(account, args.password ?? "");
      return null;
    }
    if (command === "secrets_delete") {
      keychain.delete(account);
      return null;
    }
    if (command === "secrets_get") {
      return keychain.get(account) ?? null;
    }
    throw new Error(`Unhandled invoke command: ${command}`);
  },
);

const emitMock = vi.fn(async () => undefined);
const listenMock = vi.fn(async () => () => undefined);

class MockLazyStore {
  constructor(
    _path: string,
    _options: { defaults?: Record<string, unknown>; autoSave?: number },
  ) {}

  async get(key: string): Promise<unknown> {
    if (failNextGet) {
      failNextGet = false;
      throw new Error("load failed");
    }
    return storeData[key];
  }

  async set(key: string, value: unknown): Promise<void> {
    storeData[key] = value;
  }

  async save(): Promise<void> {
    if (failNextSave) {
      failNextSave = false;
      throw new Error("save failed");
    }
  }
}

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ emit: emitMock, listen: listenMock }));
vi.mock("@tauri-apps/plugin-store", () => ({ LazyStore: MockLazyStore }));

function resetFixtures(): void {
  for (const key of Object.keys(storeData)) delete storeData[key];
  keychain.clear();
  failNextGet = false;
  failNextSave = false;
  invokeMock.mockClear();
  emitMock.mockClear();
  listenMock.mockClear();
}

async function loadPasswordManager() {
  vi.resetModules();
  return import("@/modules/terminal/lib/passwordManager");
}

describe("sanitizeTerminalPasswordEntries", () => {
  beforeEach(() => {
    resetFixtures();
  });

  it("returns an empty list for non-array payloads", async () => {
    const { sanitizeTerminalPasswordEntries } = await loadPasswordManager();
    expect(sanitizeTerminalPasswordEntries(null)).toEqual([]);
    expect(sanitizeTerminalPasswordEntries({})).toEqual([]);
  });

  it("drops invalid entries and trims fields", async () => {
    const { sanitizeTerminalPasswordEntries } = await loadPasswordManager();
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

  it("sorts entries by label", async () => {
    const { sanitizeTerminalPasswordEntries } = await loadPasswordManager();
    const out = sanitizeTerminalPasswordEntries([
      { id: "2", label: "zeta" },
      { id: "1", label: "alpha" },
    ]);
    expect(out.map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("fills missing timestamps", async () => {
    const { sanitizeTerminalPasswordEntries } = await loadPasswordManager();
    const out = sanitizeTerminalPasswordEntries([{ id: "x", label: "one" }]);
    const entry = out[0];
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeGreaterThan(0);
  });
});

describe("useTerminalPasswordStore", () => {
  beforeEach(() => {
    resetFixtures();
  });

  it("preserves leading and trailing password whitespace", async () => {
    const { useTerminalPasswordStore } = await loadPasswordManager();
    await useTerminalPasswordStore
      .getState()
      .upsert({ label: "db", secret: "  padded secret  " });

    const setCall = invokeMock.mock.calls.find(([name]) => name === "secrets_set");
    expect(setCall?.[1]).toMatchObject({ password: "  padded secret  " });
  });

  it("allows hydrate retry after a load failure", async () => {
    const { useTerminalPasswordStore } = await loadPasswordManager();
    failNextGet = true;

    await expect(useTerminalPasswordStore.getState().hydrate()).rejects.toThrow(
      "load failed",
    );
    await expect(useTerminalPasswordStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useTerminalPasswordStore.getState().hydrated).toBe(true);
  });

  it("rolls back keychain set if metadata save fails", async () => {
    const { useTerminalPasswordStore } = await loadPasswordManager();
    failNextSave = true;

    await expect(
      useTerminalPasswordStore
        .getState()
        .upsert({ id: "service", label: "service", secret: "topsecret" }),
    ).rejects.toThrow("save failed");
    expect(keychain.has("entry:service")).toBe(false);
  });

  it("restores keychain secret if remove save fails", async () => {
    const { useTerminalPasswordStore } = await loadPasswordManager();
    await useTerminalPasswordStore
      .getState()
      .upsert({ id: "entry-1", label: "service", secret: "s3cr3t" });

    failNextSave = true;
    await expect(useTerminalPasswordStore.getState().remove("entry-1")).rejects.toThrow(
      "save failed",
    );
    expect(keychain.get("entry:entry-1")).toBe("s3cr3t");
  });
});
