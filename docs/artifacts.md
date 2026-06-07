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
- The global Artifact Hub uses `artifacts_list_all` to list every durable artifact conversation from manifests without loading full artifact content.

## Artifact Hub

`+ → Artifacts` opens a first-class main workspace Artifact Hub tab. The hub lists all stored artifact conversations, lets the user pick a session/conversation, search by title/slug/kind/session, filter by artifact kind, and open a selected artifact into its per-conversation workspace tab.

The hub remains metadata-first: it uses summaries from `artifacts_list_all`, offers selection/bulk open controls plus per-card metadata copy, and loads full content only for the single artifact the user explicitly previews or opens.

## React Compilation

React artifacts are compiled through Rust with `artifacts_compile_react` and the frontend wrapper `artifactsNative.compileReact(content, previewToken)`. The compiler is a packaged pure-Rust JSX transform plus a bundled sandbox mini-runtime, so it does not rely on repo-local `node_modules`, a dev server, network imports, or an ambient Node/esbuild install.

Compiler guardrails:

- Static imports/re-exports are allowlisted to `react` and `react/jsx-runtime` only.
- JSX supports elements, fragments, quoted attributes, `className`, literal expressions (`{"Title"}`, `{42}`), dynamic expressions, nested JSX inside expressions, and basic event props.
- The bundled runtime provides minimal React-compatible `createElement`, `Fragment`, `useState`, `useReducer`, `useMemo`, `useCallback`, `useRef`, and `useEffect` behavior for preview/export.
- Workspace/path imports, network imports, Tauri imports, `node:` imports, dynamic `import(...)`, and `require(...)` are rejected with `ARTIFACT_COMPILE_FAILED` diagnostics.
- Preview compilation is invoked only when a React artifact is visible or explicitly previewed in the hub.

## Preview Security

Artifact preview uses `ArtifactPreviewFrame`, not the generic app preview pane.

- The iframe uses `sandbox="allow-scripts"` and never includes `allow-same-origin`.
- HTML/Markdown/SVG previews are wrapped with a strict CSP, no network `connect-src`, no forms, no objects, and no parent-origin access.
- Markdown/text paths escape raw HTML; SVG previews strip embedded `<script>` tags.
- Preview runtime errors are posted from the sandbox with a per-frame token and filtered by source/type/token before display in the panel.
- React preview uses the Rust compiler output instead of rendering raw React source as HTML. Failed compilation shows diagnostics in the panel.

## Delete and Restore

- Single-artifact delete moves the artifact versions and manifest entry into app-owned trash and returns an `undoToken`.
- The workspace delete toast exposes an Undo action that calls `artifacts_restore_deleted` and restores the artifact with all versions intact.
- The Artifact Hub has a Trash mode backed by `artifacts_list_deleted`; it lists deleted artifact metadata only and never loads deleted content.
- Trash entries can be restored by undo token or permanently removed with `artifacts_purge_deleted`.
- The Artifact Hub can batch export selected active artifacts, batch move selected active artifacts to trash with `artifacts_delete_many`, and batch restore selected trash artifacts with `artifacts_restore_deleted_many`.
- Batch results are metadata-only per item: target ids, optional undo token/path/hash/bytes, and error fields. They never include artifact content.
- React artifact compiler failures include structured diagnostics (`code`, `severity`, `message`, optional line/column ranges, and excerpt) while preserving the `ARTIFACT_COMPILE_FAILED` boundary.
- React artifacts support inline scoped CSS via `export const css = "...";` or `export const styles = "...";`. The compiler strips those exports from executable code and prefixes selectors under the sandbox preview root.
- Artifact ↔ browser comparison should use the existing Preview tab / Browser Automation path; see `docs/artifact-browser-comparison.md`.
- Restore emits an artifact update event with reason `restore`; delete events include only metadata plus the undo token.
- Conversation cleanup remains an explicit destructive cleanup path for Pi session deletion.

## Export

Artifact export is initiated by a reviewed save-dialog path from the UI and handled by Rust.

- The export command validates that the selected destination has an extension matching the artifact kind.
- HTML exports require `.html`/`.htm`; Markdown `.md`/`.markdown`; text `.txt`/`.text`; JSON `.json`; SVG `.svg`.
- React artifacts export as compiled HTML only, requiring `.html`/`.htm`.
- `ArtifactExportResult` returns metadata only: conversation id, slug, version, destination path, exported content hash, and exported byte count. It does not include artifact or exported file content.
