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
3. React artifact with a simple default component returning static JSX.
   - Expected: workspace artifact tab shows “Compiling React preview…” briefly.
   - Expected: compiled preview renders the JSX output.
   - Expected: raw `export default function` source is only visible on the Code tab.

## Diagnostics

1. Create a React artifact that imports a non-allowlisted package such as `lodash`.
   - Expected: preview fails with clear compile diagnostics.
   - Expected: no workspace files are read or written by the compiler.
2. Create an HTML artifact that throws a runtime error from a script.
   - Expected: runtime error appears above the preview.
   - Expected: the preview remains sandboxed without same-origin privileges.

## Versions

1. Edit an artifact through Pi or save a modified artifact version.
2. Open the Versions controls.
   - Expected: historical versions are listed as `v1`, `v2`, etc.
   - Expected: selecting an older version updates Preview and Code.
   - Expected: latest/current version labeling remains accurate.

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
