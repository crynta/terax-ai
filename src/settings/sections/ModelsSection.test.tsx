import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  error: vi.fn(),
  invoke: vi.fn(),
  setCustomEndpoints: vi.fn(),
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
vi.mock("@/modules/ai/store/chatStore", () => ({ useChatStore: vi.fn() }));
vi.mock("@/modules/settings/store", async (original) => ({
  ...(await original<typeof import("@/modules/settings/store")>()),
  setCustomEndpoints: state.setCustomEndpoints,
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
  vi.clearAllMocks();
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
