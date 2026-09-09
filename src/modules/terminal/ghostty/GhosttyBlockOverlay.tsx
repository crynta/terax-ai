import { useCallback, useSyncExternalStore } from "react";
import { BlockOverlay } from "@/modules/terminal/block/BlockOverlay";
import { BlockWatermark } from "@/modules/terminal/block/BlockWatermark";
import { ensureGhosttyBlocks } from "@/modules/terminal/ghostty/ghosttyBlockSessions";
import { ghosttyBlockGeometry } from "@/modules/terminal/ghostty/useGhosttyTerminalSession";
import {
  focusLeafInput,
  submitToLeaf,
} from "@/modules/terminal/lib/terminalSessionApi";

export default function GhosttyBlockOverlay({ leafId }: { leafId: number }) {
  const state = ensureGhosttyBlocks(leafId);
  const mode = useSyncExternalStore(state.subscribeMode, state.getMode);
  const getVisible = useCallback(
    () =>
      state.controller?.visibleBlocks(
        ghosttyBlockGeometry(leafId)?.height ?? 0,
      ) ?? { blocks: [], sticky: null, generation: 0 },
    [leafId, state],
  );
  return (
    <>
      <BlockWatermark leafId={leafId} subscribe={state.subscribeViewport} />
      <BlockOverlay
        subscribe={state.subscribeViewport}
        getVisible={getVisible}
        readOutput={(id) => state.controller?.readById(id)?.output ?? null}
        searchBlock={(id, query, signal) =>
          state.controller?.searchBlock(id, query, signal) ??
          Promise.resolve([])
        }
        revealMatch={(match) => state.controller?.revealMatch(match)}
        clearSearch={() => state.controller?.clearSearch()}
        promptReady={mode === "prompt"}
        onRunAgain={(command) => submitToLeaf(leafId, command)}
        onRestoreFocus={() => {
          if (state.getMode() === "prompt") focusLeafInput(leafId);
        }}
      />
    </>
  );
}
