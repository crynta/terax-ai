import { useCallback, useRef } from "react";
import type { WorkflowDocument } from "./schema";

const MAX_UNDO_STACK = 50;

export type WorkflowUndoRedoState = {
  canUndo: boolean;
  canRedo: boolean;
};

export function useWorkflowUndoRedo(
  document: WorkflowDocument,
  onDocumentChange: ((document: WorkflowDocument) => void) | undefined,
): {
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  undoRedoState: WorkflowUndoRedoState;
} {
  const undoStack = useRef<WorkflowDocument[]>([]);
  const redoStack = useRef<WorkflowDocument[]>([]);

  const pushUndo = useCallback(() => {
    undoStack.current.push(structuredClone(document));
    if (undoStack.current.length > MAX_UNDO_STACK) {
      undoStack.current.shift();
    }
    redoStack.current = [];
  }, [document]);

  const undo = useCallback(() => {
    if (!onDocumentChange || undoStack.current.length === 0) return;
    redoStack.current.push(structuredClone(document));
    const previous = undoStack.current.pop()!;
    onDocumentChange(previous);
  }, [document, onDocumentChange]);

  const redo = useCallback(() => {
    if (!onDocumentChange || redoStack.current.length === 0) return;
    undoStack.current.push(structuredClone(document));
    const next = redoStack.current.pop()!;
    onDocumentChange(next);
  }, [document, onDocumentChange]);

  return {
    pushUndo,
    undo,
    redo,
    undoRedoState: {
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    },
  };
}
