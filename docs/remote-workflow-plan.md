# Terax Remote Workflow Plan

## Summary

- Create a local branch `local/remote-workflow` and keep this plan in `docs/remote-workflow-plan.md`.
- Build two local-only features first, with no upstream PR/release unless explicitly requested later:
  - Terminal URL requests open in a Terax Preview tab by default, with an external-browser fallback.
  - File Explorer, editor, and AI file tools can work with remote SSH/SFTP paths.
- Extend the same local build with remote-terminal quality-of-life fixes:
  - macOS Option/Alt works as Meta in zellij/tmux.
  - OSC 52 clipboard writes from remote terminal apps can update the local clipboard.
  - SSH detection resolves the remote home directory and switches the File Explorer automatically.
  - Dragging local files into a remote terminal uploads them to the current remote directory and inserts shell-quoted remote paths.
  - Large TERAX-Custom windows apply a moderate whole-UI auto scale.
  - Binary editor tabs can preview PDFs and common image formats instead of only showing “preview not supported”.
  - Package the result as `TERAX-Custom` with its own bundle identifier, separate from upstream Terax.

## Interfaces & UX

- Extend OSC `8888` from file-only to:
  - `file=<encoded-path>`: existing behavior, opens editor tab.
  - `url=<encoded-url>[;target=preview|browser]`: default `target=preview`.
  - `remote-cwd=<encoded-ssh-uri>`: sets active terminal cwd/root to a remote workspace.
- Add shell helpers in Terax shell integration:
  - `terax-preview URL`: opens URL in Terax Preview.
  - `terax-open URL`: alias for preview-first behavior.
  - `terax-open-browser URL`: opens local system browser.
  - Keep existing `terax_open FILE`/`tp` behavior unchanged.
- Remote path format:
  - `ssh://[user@]host[:port]/absolute/path`
  - `host` may be an alias from `~/.ssh/config`.
  - Opportunistic SSH cwd detection: use remote OSC 7 or `remote-cwd` when the remote shell emits it; otherwise require manual remote root.

## Implementation Changes

- Terminal/Preview:
  - Update OSC parsing in `src/modules/terminal/lib/osc-handlers.ts` to return a discriminated input type for `file`, `url`, and `remote-cwd`.
  - Update `App.tsx` terminal-open handling: URLs open preview by default; `target=browser` calls Tauri opener.
  - Add URL validation for `http://` and `https://`; ignore unsafe/unsupported schemes.
  - Register an OSC 52 clipboard handler so zellij/tmux/neovim can copy from an SSH session into the local clipboard.
  - Cap OSC 52 payloads and ignore clipboard read/query requests.
  - Configure xterm `macOptionIsMeta` so Option/Alt keybindings pass through to terminal multiplexers.
  - Detect typed `ssh ...` commands, resolve the target home directory over SFTP, and switch the active terminal cwd/File Explorer root automatically.
  - Keep the status-bar `Open remote files` chip as a retry path when home resolution fails or the user switches away before resolution finishes.
  - Handle Tauri file-drop events over terminal panes. Local sessions insert shell-quoted local paths; remote sessions upload files over SFTP first and insert remote POSIX paths.
  - Apply moderate whole-webview zoom on large windows and refit xterm after zoom changes.
- Remote FS:
  - Add a Rust FS backend layer behind existing `fs_*` Tauri commands so command names stay stable.
  - Local paths continue using `std::fs`; `ssh://...` paths use built-in SFTP.
  - Use `ssh2` + `ssh2-config`: SSH agent first, then configured identity files; no password prompt in v1.
  - Enforce known-host verification; on unknown/mismatched hosts, return a clear error telling the user to connect once via normal `ssh` or update known hosts.
  - Implement remote `read_dir`, `read_file`, `write_file`, `stat`, `create_file`, `create_dir`, `rename`, and recursive delete.
  - Remote writes use sibling temp file plus rename, mirroring local atomic-write behavior.
  - Add remote helper commands for resolving SSH home directories and uploading dropped local files as binary data.
- Frontend/AI:
  - Add shared path utilities that preserve `ssh://host/...` authority when joining, dirname-ing, and displaying paths.
  - File Explorer accepts local or remote roots.
  - File Explorer header provides a root input so the user can switch explicitly between local paths and `ssh://...` remote paths.
  - Editor tabs store remote URI paths unchanged.
  - Binary editor state renders PDFs/images from a bounded byte-read Blob URL; generic binaries show metadata only.
  - AI `read_file`, `write_file`, and `list_directory` work with remote URIs while preserving existing sensitive-path checks.
- Packaging:
  - Rename the local build to `TERAX-Custom`.
  - Use bundle id `com.simonfestl.teraxcustom`.
  - Disable upstream updater configuration for the custom app so it cannot overwrite itself with an official release.

## Test Plan

- Run:
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/tsc && ./node_modules/.bin/vite build`
  - `cd src-tauri && cargo check`
  - `cd src-tauri && cargo test remote::tests`
  - `cd src-tauri && TERAX_REMOTE_TEST_URI=ssh://hetzner-vm/home/simonfestl/.terax-remote-test cargo test remote_sftp_smoke -- --ignored --nocapture`
  - `cd src-tauri && cargo clippy`
  - `pnpm tauri build`
- Manual terminal tests:
  - `terax-preview http://localhost:3000` opens a Terax Preview tab.
  - `terax-open-browser https://example.com` opens the system browser.
  - Existing `terax_open somefile.ts` still opens an editor tab.
  - An OSC URL printed from inside SSH opens locally in Terax.
  - A zellij/tmux OSC 52 copy from SSH updates the local macOS clipboard.
  - Typing `ssh hetzner-vm` switches the File Explorer to the resolved remote home without manual root entry.
  - Dragging a macOS screenshot into a local terminal inserts the local path without pressing Enter.
  - Dragging a macOS screenshot into an SSH/zellij terminal uploads it to the remote cwd and inserts the remote path.
  - Maximizing TERAX-Custom on a large monitor scales Terminal, Explorer, tabs, statusbar, and AI controls together.
  - Opening `docs/terminal.png` shows an image preview, and opening a `.pdf` shows an inline PDF preview.
- Manual remote FS tests:
  - Browse `ssh://alias/home/user/project`.
  - Open, edit, save, create, rename, and delete a remote test file.
  - Verify permission denied, unknown host, missing key, and missing path errors are readable.
  - Verify `.ssh`, `.env`, credentials paths remain blocked for AI file tools.

## Assumptions

- Preview-first is the default; external browser remains available as fallback.
- SSH detection updates Terax UI state only; it does not rewrite or wrap the user’s `ssh` command.
- v1 supports SSH agent and identity-file auth only; password/passphrase UI is deferred.
- ProxyJump/ProxyCommand and remote `rg` search are deferred unless needed after the MVP works.
- Remote clipboard needs the remote app to emit OSC 52; Terax handles the local receiving side.
