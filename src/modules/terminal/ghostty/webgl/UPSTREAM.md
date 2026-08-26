# xterm.js WebGL renderer fork

This directory is a narrow adaptation of the xterm.js WebGL renderer. It keeps
the renderer algorithms and lifecycle patterns that are useful to Terax while
replacing xterm.js terminal internals with `libghostty-vt` render state.

- Repository: https://github.com/xtermjs/xterm.js
- Package: `@xterm/addon-webgl`
- Version: `0.20.0-beta.298`
- Commit: `8c9b9fdb9ba7b72b677173225f69c2a47f807600`
- License: MIT, retained in `LICENSE.xterm-js`

The adapted renderer intentionally does not construct an xterm.js `Terminal`.
Terax owns PTY transport, model lifetime, input, selection, scheduling, and the
renderer pool. Ghostty owns parsing, reflow, scrollback, and render state.

Terax-specific changes include a single-channel glyph coverage atlas, shared
frame scheduling, renderer leasing for visible panes, direct typed WASM cell
reads, retained dirty-row GPU uploads, extended Ghostty decorations,
damage-free cursor and text blink presentation, exact resource diagnostics,
and bounded idle-context reclamation.
