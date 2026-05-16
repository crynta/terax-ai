# feat(editor): add Jupyter Notebook (.ipynb) support

## What
Adds interactive `.ipynb` support to the Terax editor, including notebook rendering, cell editing, Python execution, rich output rendering, and Jupyter-style keyboard shortcuts.

## Why
Terax currently treats notebooks like ordinary files, which blocks common data-science and learning workflows. This lets users open, edit, run, and save Jupyter notebooks without leaving the app.

## How
Added a dedicated notebook editor path for `.ipynb` files:

- `EditorStack` routes notebook files to `NotebookPane`.
- `NotebookPane` owns notebook parsing, dirty-state updates, cell operations, run-all, clear-output, and command/edit mode shortcuts.
- `NotebookCell` renders each cell with CodeMirror editing, markdown preview, toolbar actions, and inline autocomplete context from previous code cells.
- `NotebookOutput` renders streams, images, HTML, JSON, and plain-text outputs.
- `src-tauri/src/modules/notebook/exec.rs` manages a per-notebook Python kernel process and returns nbformat-style execution results.

## Testing
Verified the main notebook flows manually:

- Opened an `.ipynb` file and confirmed it renders as notebook cells instead of raw JSON.
- Edited code and markdown cells, switched cell types, added, moved, duplicated, and deleted cells.
- Ran individual cells with the toolbar and keyboard shortcuts.
- Confirmed `Shift+Enter` runs while typing inside a cell instead of inserting a newline.
- Confirmed previous executed cells remain available to later cells in the same notebook kernel.
- Used `Run All` after `Clear Outputs` and confirmed code cells execute and outputs repopulate.
- Rendered stream output and matplotlib image output.
- Saved the notebook and confirmed serialized `.ipynb` content remains valid.

- [x] `pnpm exec tsc --noEmit` clean
- [x] Manual smoke-test of the affected feature
- [x] (If you touched `src-tauri/`) `cargo check` clean
- [x] (If UI) tested in `pnpm tauri dev`

## Screenshots / GIFs
Required for this UI change. Please attach before/after screenshots or a short GIF showing:

- Opening an `.ipynb` file in the notebook editor.
- Running a cell and rendering output.
- Using `Shift+Enter` from inside a code cell.

## Notes for reviewer
The backend uses a lightweight per-notebook Python process rather than a full Jupyter kernel protocol implementation. This keeps the feature small, but follow-up work could add kernel restart/interrupt controls, richer error output typing, and broader MIME output coverage.
