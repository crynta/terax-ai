# Artifact ↔ Browser Comparison Workflow

Artifacts are a safe prototype lane. The in-app browser/preview tab remains the real application verification lane.

## Recommended flow

1. Create or open the artifact in the Artifact Workspace.
2. Use the artifact preview to validate the prototype in the sandbox.
3. Open the real app in a Preview tab or Browser Automation workflow node.
4. Compare the artifact against the live app using explicit user-approved browser automation.
5. Treat the browser result as the source of truth for real app behavior.

## Guardrails

- Do not mount artifact React into Terax/app React.
- Do not grant artifact previews access to Tauri, workspace files, app state, or network.
- Do not implicitly load full artifact content from the Hub; content is loaded only by explicit open/preview/read/export actions.
- Browser comparison should be approval-boundary-safe and use the existing browser automation workflow path.

## Suggested browser automation prompt

Use this when comparing an artifact prototype to a real app route:

> Compare the selected artifact prototype against the live app at `<URL>`. Inspect layout, copy, interactive states, accessibility-relevant affordances, and obvious visual regressions. The artifact is a prototype; the browser route is the real app source of truth. Return concise differences grouped by severity and include reproduction notes for anything actionable.

## Deferred product work

A first-class comparison command can be added later if this becomes frequent. It should:

- Ask for the target app URL explicitly.
- Load artifact content only after the user selects the artifact.
- Route browser inspection through existing approved Browser Automation.
- Store only metadata and comparison notes unless the user explicitly exports evidence.
