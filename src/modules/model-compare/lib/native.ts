import { invoke } from "@tauri-apps/api/core";
import {
  type ModelCompareHistoryEntry,
  parseModelCompareHistoryValue,
} from "./modelCompareHistory";

export const modelCompareHistoryNative = {
  load: async () => {
    const raw = await invoke<unknown>("model_compare_history_get");
    return parseModelCompareHistoryValue(raw);
  },
  save: (entries: readonly ModelCompareHistoryEntry[]) =>
    invoke<void>("model_compare_history_put", { entries }),
  clear: () => invoke<void>("model_compare_history_clear"),
};
