/**
 * Tauri's native drag-drop events, rebuilt from HTML5 drops: files dragged
 * from VS Code's Explorer or editor tabs arrive as `file://` URIs.
 */
type DragDropPayload =
  | { type: "enter" | "over"; position: { x: number; y: number }; paths?: string[] }
  | { type: "drop"; position: { x: number; y: number }; paths: string[] }
  | { type: "leave" };

type Handler = (event: { payload: DragDropPayload }) => void;

function droppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const raw =
    dt.getData("application/vnd.code.uri-list") || dt.getData("text/uri-list") || "";
  return raw
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("file://"))
    .map((l) => decodeURIComponent(new URL(l).pathname));
}

const carriesUris = (dt: DataTransfer | null) =>
  !!dt &&
  Array.from(dt.types).some(
    (t) => t === "text/uri-list" || t === "application/vnd.code.uri-list",
  );

export function getCurrentWebview() {
  return {
    async onDragDropEvent(handler: Handler): Promise<() => void> {
      const over = (e: DragEvent) => {
        if (!carriesUris(e.dataTransfer)) return;
        e.preventDefault();
        handler({ payload: { type: "over", position: { x: e.clientX, y: e.clientY } } });
      };
      const leave = (e: DragEvent) => {
        if (e.relatedTarget === null) handler({ payload: { type: "leave" } });
      };
      const drop = (e: DragEvent) => {
        const paths = droppedPaths(e.dataTransfer);
        if (paths.length === 0) return;
        e.preventDefault();
        handler({
          payload: { type: "drop", position: { x: e.clientX, y: e.clientY }, paths },
        });
      };
      document.addEventListener("dragover", over);
      document.addEventListener("dragleave", leave);
      document.addEventListener("drop", drop);
      return () => {
        document.removeEventListener("dragover", over);
        document.removeEventListener("dragleave", leave);
        document.removeEventListener("drop", drop);
      };
    },
  };
}
