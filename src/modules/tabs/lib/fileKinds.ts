export type DefaultFileView = "editor" | "notebook";

export function isMarkdownPreviewPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

export function isNotebookPath(path: string): boolean {
  return /\.ipynb$/i.test(path);
}

export function defaultFileViewForPath(path: string): DefaultFileView {
  return isNotebookPath(path) ? "notebook" : "editor";
}
