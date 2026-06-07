import { useEffect, useMemo, useState } from "react";
import type { BlockMode } from "../block/lib/modeMachine";
import {
  getLeafBlockMode,
  interruptLeaf,
  leafCwd,
  submitToLeaf,
  subscribeLeafBlockMode,
} from "./useTerminalSession";

export type BlockController = {
  blockMode: BlockMode;
  submitCommand: (text: string) => void;
  interrupt: () => void;
  getCwd: () => string | null;
};

export function useBlockController(
  leafId: number | null,
): BlockController | null {
  const [blockMode, setBlockMode] = useState<BlockMode>("prompt");

  useEffect(() => {
    if (leafId == null) return;
    setBlockMode(getLeafBlockMode(leafId));
    return subscribeLeafBlockMode(leafId, () =>
      setBlockMode(getLeafBlockMode(leafId)),
    );
  }, [leafId]);

  return useMemo(() => {
    if (leafId == null) return null;
    return {
      blockMode,
      submitCommand: (text) => submitToLeaf(leafId, text),
      interrupt: () => interruptLeaf(leafId),
      getCwd: () => leafCwd(leafId),
    };
  }, [leafId, blockMode]);
}
