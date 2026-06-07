# Artifact Manual QA Smoke

Use this checklist for a local Tauri smoke run after artifact, Chat, Inbox, or Pi workspace-tab changes.

## Setup

1. Start the app with a normal Tauri development or packaged build.
2. Open the Chat sidebar surface.
3. Create or select a Pi session.

## Create and Preview

Ask Pi to create these artifacts in the active Chat session:

1. HTML artifact with a visible `<h1>`.
   - Expected: a main workspace artifact tab opens automatically.
   - Expected: Preview tab renders the HTML in an iframe.
   - Expected: iframe sandbox does not include `allow-same-origin`.
2. Markdown artifact with a heading and raw `<script>` text.
   - Expected: heading renders.
   - Expected: raw script text is escaped, not executed.
3. React artifact with a default component using static JSX, expressions, `useState`, and an `onClick` counter.
   - Expected: workspace artifact tab shows “Compiling React preview…” briefly.
   - Expected: compiled preview renders the JSX output, expressions, and updates when the counter is clicked.
   - Expected: raw `export default function` source is only visible on the Code tab.

## Diagnostics

1. Create a React artifact that imports a non-allowlisted package such as `lodash`.
   - Expected: preview fails with clear compile diagnostics.
   - Expected: no workspace files are read or written by the compiler.
2. Create an HTML artifact that throws a runtime error from a script.
   - Expected: runtime error appears above the preview.
   - Expected: the preview remains sandboxed without same-origin privileges.

## Artifact Hub

1. Choose `+ → Artifacts` from the main tab menu.
   - Expected: a main workspace **Artifacts** hub tab opens.
   - Expected: the left side lists all stored artifact conversations plus an “All sessions” row.
2. Search by artifact title/slug/session and use the kind filter buttons.
   - Expected: rows filter without loading full artifact source.
3. Click **Preview** on an artifact card.
   - Expected: the preview rail loads only that artifact’s content and shows title/version/content-hash metadata.
4. Use **Copy ref**, **Select visible**, **Clear**, and **Open first**.
   - Expected: metadata copy/bulk controls work without loading every artifact’s source.
5. Click **Open** on an artifact card.
   - Expected: a per-conversation workspace artifact tab opens and selects that artifact.

## Edit and Versions

1. Open the main workspace artifact tab on the latest version.
2. Click the visible **Edit** button in the artifact header.
   - Expected: an `Artifact source` editor appears with **Cancel** and **Save changes** actions.
3. Change the source and click **Save changes**.
   - Expected: preview/source update and a new artifact version is created.
4. Open the Versions controls.
   - Expected: historical versions are listed as `v1`, `v2`, etc.
   - Expected: selecting an older version updates Preview and Code.
   - Expected: latest/current version labeling remains accurate.

## Delete and Restore

1. Delete a single artifact from the workspace artifact header.
   - Expected: the artifact disappears from the list and the toast says it moved to trash.
   - Expected: clicking **Undo** restores the artifact, all versions, and the selected artifact tab state.
2. Delete another artifact and do not click Undo.
   - Expected: Artifact Hub no longer lists it in Active mode, but no workspace files are touched.
3. Open `+ → Artifacts` and switch to **Trash**.
   - Expected: deleted artifacts are listed with metadata only.
   - Expected: **Restore** returns the artifact to Active mode with versions intact.
   - Expected: **Delete forever** purges only the selected deleted artifact.
4. Select multiple Active artifacts in the Hub.
   - Expected: **Export selected** asks for a folder and writes one safe filename per artifact.
   - Expected: **Move to trash** moves selected artifacts only and shows a per-item success/failure count.
5. Select multiple Trash artifacts.
   - Expected: **Restore selected** restores selected artifacts only and shows a per-item success/failure count.
6. Create a React artifact with `export const css = ".card { color: red; }";` and a `.card` element.
   - Expected: preview/export applies the style inside the sandbox and does not leak CSS to Terax UI.

## Export

1. Export HTML, Markdown, text, JSON, and SVG artifacts.
   - Expected: save dialog suggests the matching extension.
   - Expected: Rust rejects mismatched destination extensions.
   - Expected: export toast/result shows path metadata, not artifact content.
2. Export a React artifact.
   - Expected: save dialog suggests `.html`.
   - Expected: exported file is compiled HTML.
   - Expected: exported file does not contain raw React source.

## Session Cleanup

1. Delete the Pi session from the sidebar.
   - Expected: Pi session disappears after the session delete event.
   - Expected: artifacts for that conversation are deleted.
   - Expected: if artifact cleanup fails, the UI reports the cleanup error without hiding the successful session deletion.

## Inbox and Badges

1. Create an artifact in a session that is not the currently visible Chat session.
   - Expected: Inbox/artifact row appears for the relevant session.
   - Expected: opening the row opens the main workspace artifact tab and selects that artifact.
2. Mark artifact/chat rows read.
   - Expected: scoped Chat/Inbox badges update without clearing unrelated Code Pi notifications.
3. Open `+ → Artifacts` after marking rows read.
   - Expected: the durable Artifact Hub still lists stored artifacts independently from Inbox read state.
