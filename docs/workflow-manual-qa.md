# Workflow Manual QA Smoke

Use this checklist for a local Tauri smoke run after workflow canvas, runtime, provider, artifact, or restore changes.

## Setup

1. Start the app with `pnpm tauri dev` or a packaged build.
2. Open or create a workspace with safe disposable files.
3. Create a new workflow tab from the Terax UI.
4. Use a saved workflow file path before checking durable artifact persistence.

## Canvas and Runtime

1. Add Text, Image, Video, Audio, HTTP, File, Browser, Shell, Agent, Terminal, and Output nodes.
   - Expected: each node appears on the React Flow canvas with handles and editable fields.
   - Expected: Shell, File, Browser, and Agent nodes visibly require approval before unsafe execution.
2. Connect Text → HTTP by dragging either compatible handle to the other handle, or click the source handle once and then click the target handle.
   - Expected: a primary-colored curved line with an arrow appears between connected nodes.
   - Expected: clicking a handle shows a selected-handle message; clicking a compatible opposite handle creates the edge.
   - Expected: `Run safe` completes Text and runs HTTP.
   - Expected: HTTP artifacts show status, response headers/body metadata, and no request secrets in the Runtime artifact gallery.
   - Note: HTTP outputs JSON, while the Output node accepts image/audio/video only; HTTP → Output should be rejected as an incompatible connection.
3. Connect Text → Image → Output to validate media output wiring.
   - Expected: the Image node accepts the Text prompt, creates an image artifact, and the Output node can collect/display the image artifact.
4. Delete a node and clear a disposable canvas.
   - Expected: each node has a `Delete node` action; deleting a node removes its connected edges and node-owned artifacts.
   - Expected: selecting a node enables `Delete selected`, and Delete/Backspace removes the selected node unless focus is in an input field.
   - Expected: `Clear canvas` asks for confirmation, then removes all nodes, edges, and artifacts from the workflow canvas.
5. Cancel an in-flight HTTP/video/agent/shell run.
   - Expected: runtime status changes to cancelled.
   - Expected: partial runtime logs may remain, but no completed artifact is created after cancellation.

## Approval-Gated Automation

1. Shell node: run a harmless command such as `printf 'hello workflow'`.
   - Expected: approval card shows command and shell risk text.
   - Expected: approving streams output, then creates audited stdout/stderr artifact.
2. File node: read a disposable text file.
   - Expected: approval card shows operation/path and file-operation risk text.
   - Expected: approving creates a file result artifact with path, kind, size, and content for text files.
3. File node: write/append/delete only in a disposable directory.
   - Expected: each operation is approval-gated.
   - Expected: writes use source `workflow-file-operation` and filesystem watchers update UI.
4. Browser node: provide a safe public URL and extraction instruction.
   - Expected: approval card shows URL/instructions and browser risk text.
   - Expected: approving routes through the Pi runtime and streams progress/result text.
5. Agent node: provide a prompt such as `Summarize this workflow`.
   - Expected: approving starts a Pi session, streams output, supports cancellation, and creates audited result artifact.

## Provider Configuration

1. Configure OpenAI image/audio/video providers with no key present.
   - Expected: provider badge says the OpenAI key is missing.
   - Expected: no key value is displayed in the workflow UI or artifacts.
2. Add an OpenAI key in settings and rerun provider nodes.
   - Expected: provider badge changes to configured.
   - Expected: model dropdowns include built-in model suggestions and provider-specific settings.
3. Switch to placeholder/local providers.
   - Expected: key badge says no key required.
   - Expected: placeholder artifacts remain deterministic and do not call external services.
   - Expected: placeholder image artifacts render as a visible placeholder image, not a broken image/question-mark icon, and persist/export with an image media type such as `image/svg+xml`.

## Artifact Gallery

1. Generate text, image, audio, video, JSON, file, shell, agent, HTTP, and browser artifacts.
   - Expected: artifact count updates in Runtime panel.
   - Expected: preview shows appropriate media controls or text preview.
   - Expected: metadata chips show media type, size, provider/model, and filename when available.
2. Use artifact controls.
   - Expected: Open opens browser-renderable artifacts or reveals local files.
   - Expected: Reveal opens the containing folder for stored artifacts.
   - Expected: Copy path copies the durable artifact path/source.
3. Save a workflow file and rerun media providers.
   - Expected: binary media data URLs are persisted under `.terax-workflow-artifacts/<workflow-id>/` next to the workflow file.

## Persistence and Restore

1. Save a workflow with completed artifacts and runtime logs.
2. Close and reopen the app.
   - Expected: workflow tabs, active tab, dirty state, and saved file path restore.
   - Expected: runtime state, progress, logs, and artifacts are stripped from restored tabs.
3. Open the saved workflow JSON directly.
   - Expected: workflow schema validates and loads.
   - Expected: artifact/runtime state is not restored from persisted JSON unless intentionally imported as artifact data.

## Verification Commands

Run before manual QA or after fixes:

```sh
pnpm exec biome check .
pnpm exec tsc --noEmit
pnpm test
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Latest Headless Result

The workflow roadmap changes include automated coverage for schema, restore, providers, HTTP, shell, agent, file/browser automation executors, artifact storage, and e2e-style runtime flows. A real Tauri window smoke run is still required for visual confirmation and OS integration checks.
