# Chat Artifacts

Terax chat artifacts are durable, app-owned outputs attached to Pi sessions. They are not workspace files until the user explicitly exports them.

For hands-on validation after artifact changes, use the [Artifact Manual QA Smoke](./artifacts-manual-qa.md) checklist.

## Ownership and Tool Boundary

- Rust owns artifact storage, versioning, validation, events, export, and React compilation.
- Pi can call `create_artifact`, `edit_artifact`, `read_artifact`, and `list_artifacts` through the Rust-mediated native tool bridge.
- Artifact tools derive the conversation from the verified Pi session id. Model-provided `conversationId` values are rejected.
- `create_artifact`, `edit_artifact`, `list_artifacts`, export results, and artifact events return metadata/summaries only. Full content is only returned by explicit `read_artifact`, and that result is capped.
- Artifact writes use app-owned state and do not change the existing workspace approval boundary: only `bash`, `edit`, and `write` require approval.

## Storage and Versions

- Artifacts are stored under the app artifact store by conversation key, slug, and version.
- Slugs and conversation ids are validated before filesystem access.
- Each create/update/edit records a new version with content hash, byte count, timestamps, kind, and title metadata.
- The main workspace artifact tab can browse historical versions through `artifacts_versions` plus versioned `artifacts_get`.

## React Compilation

React artifacts are compiled through Rust with `artifacts_compile_react` and the frontend wrapper `artifactsNative.compileReact(content)`. The current compiler is a packaged pure-Rust static JSX preview/export path, so it does not rely on repo-local `node_modules`, a dev server, or an ambient Node/esbuild install.

Compiler guardrails:

- Static imports/re-exports are allowlisted to `react` and `react/jsx-runtime` only.
- Workspace/path imports, network imports, Tauri imports, `node:` imports, dynamic `import(...)`, and `require(...)` are rejected with `ARTIFACT_COMPILE_FAILED` diagnostics.
- Preview compilation is invoked only when a React artifact is visible.

## Preview Security

Artifact preview uses `ArtifactPreviewFrame`, not the generic app preview pane.

- The iframe uses `sandbox="allow-scripts"` and never includes `allow-same-origin`.
- HTML/Markdown/SVG previews are wrapped with a strict CSP, no network `connect-src`, no forms, no objects, and no parent-origin access.
- Markdown/text paths escape raw HTML; SVG previews strip embedded `<script>` tags.
- Preview runtime errors are posted from the sandbox with a per-frame token and filtered by source/type/token before display in the panel.
- React preview uses the Rust compiler output instead of rendering raw React source as HTML. Failed compilation shows diagnostics in the panel.

## Export

Artifact export is initiated by a reviewed save-dialog path from the UI and handled by Rust.

- The export command validates that the selected destination has an extension matching the artifact kind.
- HTML exports require `.html`/`.htm`; Markdown `.md`/`.markdown`; text `.txt`/`.text`; JSON `.json`; SVG `.svg`.
- React artifacts export as compiled HTML only, requiring `.html`/`.htm`.
- `ArtifactExportResult` returns metadata only: conversation id, slug, version, destination path, exported content hash, and exported byte count. It does not include artifact or exported file content.
