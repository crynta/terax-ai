<!--
PR title should follow Conventional Commits - it becomes the squash commit message.
Examples: feat(terminal): add split panes / fix(explorer): close button alignment
-->

## What
<!-- One or two sentences describing the change. -->

## Why
<!-- The problem you're solving. Link to the issue if there is one (e.g. "Closes #42"). -->

## How
<!-- Brief notes on the approach, only if non-obvious. -->

## Testing
<!-- How did you verify this works? "Ran tsc clean" is not enough on its own -
     describe the actual flows you exercised. -->

- [ ] `pnpm lint` clean
- [ ] `pnpm check-types` clean
- [ ] `pnpm test` clean
- [ ] Manual smoke-test of the affected feature
- [ ] (If you touched `src-tauri/`) `cargo clippy --all-targets --locked -- -D warnings` clean
- [ ] (If you touched `src-tauri/`) `cargo nextest run --locked` clean (or `cargo test --locked`)
- [ ] (If you changed a `#[tauri::command]` signature) called out below so the FE caller can be updated in lockstep
- [ ] (If UI) tested in `pnpm tauri dev`
- [ ] Platforms tested: <!-- macOS / Linux / Windows -->
- [ ] Shells tested (if relevant): <!-- bash / zsh / fish / pwsh / cmd -->


## Screenshots / GIFs
<!-- Required for any UI change. Before / after if applicable. -->

## Notes for reviewer
<!-- Anything risky, anything you want a second opinion on, follow-ups for later. -->
