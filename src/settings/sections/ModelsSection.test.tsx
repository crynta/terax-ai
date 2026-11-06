import { isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  error: vi.fn(),
  invoke: vi.fn(),
  setCustomEndpoints: vi.fn(),
  setFavoriteModelIds: vi.fn(),
  setRecentModelIds: vi.fn(),
  setOpenrouterModelId: vi.fn(),
  emitKeysChanged: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => {
    const index = state.cursor++;
    return [state.slots[index], state.setters[index]];
  },
  useEffect: () => {},
}));
vi.mock("react/compiler-runtime", () => ({
  c: (n: number) => Array(n).fill(Symbol.for("react.memo_cache_sentinel")),
}));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: state.invoke }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/modules/ai/store/chatStore", () => ({
  useChatStore: {
    getState: () => ({ selectedModelId: "other", setSelectedModelId: vi.fn() }),
  },
}));
vi.mock("@/modules/settings/store", async (original) => ({
  ...(await original<typeof import("@/modules/settings/store")>()),
  setCustomEndpoints: state.setCustomEndpoints,
  setFavoriteModelIds: state.setFavoriteModelIds,
  setRecentModelIds: state.setRecentModelIds,
  setOpenrouterModelId: state.setOpenrouterModelId,
  emitKeysChanged: state.emitKeysChanged,
}));
vi.mock("@/modules/settings/preferences", () => {
  const prefs = new Proxy(
    {
      customEndpoints: [
        {
          id: "custom",
          name: "Custom",
          baseURL: "https://example.com",
          modelId: "model",
          contextLimit: 1000,
        },
      ],
      openrouterModelId: "model",
      favoriteModelIds: ["compat-custom"],
      recentModelIds: [],
    },
    { get: (target, key) => Reflect.get(target, key) ?? "" },
  );
  return {
    usePreferencesStore: Object.assign(
      (selector: (s: unknown) => unknown) => selector(prefs),
      { getState: () => prefs },
    ),
  };
});

vi.mock("./AboutSection", () => ({ AboutSection: () => null }));
vi.mock("./AgentsSection", () => ({ AgentsSection: () => null }));
vi.mock("./EditorSection", () => ({ EditorSection: () => null }));
vi.mock("./GeneralSection", () => ({ GeneralSection: () => null }));
vi.mock("./ShortcutsSection", () => ({ ShortcutsSection: () => null }));
vi.mock("./ThemesSection", () => ({ ThemesSection: () => null }));
import { ModelsSection } from "./ModelsSection";

function card(
  node: ReactNode,
  id: string,
): { onRemove: () => Promise<void> } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = card(child, id);
      if (found) return found;
    }
  } else if (
    isValidElement<{
      provider?: { id: string };
      endpoint?: { id: string };
      onRemove: () => Promise<void>;
      children?: ReactNode;
    }>(node)
  ) {
    if (node.props.provider?.id === id || node.props.endpoint?.id === id)
      return node.props;
    return card(node.props.children, id);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  state.cursor = 0;
  state.slots = [
    { openai: "stored", openrouter: "stored" },
    { custom: "stored" },
    new Set(),
  ];
  state.setters = [vi.fn(), vi.fn(), vi.fn()];
  state.invoke.mockRejectedValue(new Error("keychain denied"));
});

it.each(["openai", "openrouter", "custom"])(
  "retains %s settings and reports a failed deletion",
  async (id) => {
    const target = card(ModelsSection(), id);
    expect(target).toBeDefined();
    await target?.onRemove();
    expect(state.error).toHaveBeenCalledWith("Could not remove credential", {
      description: "Error: keychain denied",
    });
    expect(state.setCustomEndpoints).not.toHaveBeenCalled();
    expect(state.setOpenrouterModelId).not.toHaveBeenCalled();
    expect(state.emitKeysChanged).not.toHaveBeenCalled();
    for (const setter of state.setters) expect(setter).not.toHaveBeenCalled();
  },
);

it("keeps endpoint removal moving after a settings write fails", async () => {
  state.invoke.mockResolvedValue(undefined);
  state.setFavoriteModelIds.mockRejectedValue(new Error("settings failed"));
  await card(ModelsSection(), "custom")?.onRemove();
  expect(state.setCustomEndpoints).toHaveBeenCalledWith([]);
  expect(state.emitKeysChanged).toHaveBeenCalled();
  expect(state.error).toHaveBeenCalledWith(
    "Credential removed; settings may be incomplete",
    {
      description: "Error: settings failed",
    },
  );
});

it("reports a notification failure after successful deletion without abandoning provider cleanup", async () => {
  state.invoke.mockResolvedValue(undefined);
  state.emitKeysChanged.mockRejectedValue(new Error("notification failed"));
  await card(ModelsSection(), "openrouter")?.onRemove();
  expect(state.setOpenrouterModelId).toHaveBeenCalledWith("");
  expect(state.error).toHaveBeenCalledWith(
    "Credential removed; settings may be incomplete",
    {
      description: "Error: notification failed",
    },
  );
});

it.each(["models", "general"])(
  "keeps the toast renderer mounted on the %s settings tab",
  async (tab) => {
    const { Toaster } = await import("@/components/ui/sonner");
    const { SettingsApp } = await import("../SettingsApp");
    state.slots = [tab];
    const root = SettingsApp();
    expect(
      root.props.children.some(
        (child: ReactNode) => isValidElement(child) && child.type === Toaster,
      ),
    ).toBe(true);
  },
);
