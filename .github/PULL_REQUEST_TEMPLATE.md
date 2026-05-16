<!--
PR title should follow Conventional Commits — it becomes the squash commit message.
Examples: feat(terminal): add split panes / fix(explorer): close button alignment
-->

## What
<!-- One or two sentences describing the change. -->

## Why
<!-- The problem you're solving. Link to the issue if there is one (e.g. "Closes #42"). -->

## How
<!-- Brief notes on the approach, only if non-obvious. -->

## Testing
<!-- How did you verify this works? "Ran tsc clean" is not enough on its own —
     describe the actual flows you exercised. -->

- [ ] `pnpm exec tsc --noEmit` clean
- [ ] Manual smoke-test of the affected feature
- [ ] (If you touched `src-tauri/`) `cargo check` clean
- [ ] (If UI) tested in `pnpm dev`

## Screenshots / GIFs
<!-- Required for any UI change. Before / after if applicable. -->

## Notes for reviewer
<!-- Anything risky, anything you want a second opinion on, follow-ups for later. -->
