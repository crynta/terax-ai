# Terminal symbols

`terax-terminal-symbols.woff2` contains all 10,071 mapped private-use characters
from Ghostty's `JetBrainsMonoNerdFont-Regular.ttf`, including Powerline, Devicons,
Seti, Codicons, Font Awesome, and Material Design icons. Text and color emoji
continue using the selected text font and platform fallback. The subset keeps
the original cell metrics and outlines, removes hinting, and renames the family
to Terax Terminal Symbols.

Source: Ghostty revision `349f026087d948f8f898dca3231ff91438f83ab8`,
`src/font/res/JetBrainsMonoNerdFont-Regular.ttf`.

- Source SHA-256: `a2f4268a1719b95d1f1448376173a42317919cb598423f18ea327eaca13dd916`
- WOFF2 SHA-256: `8018ddbbb42236f39b011df985e1cae09b26a477e9549850b3ee914c31b90e4b`
- WOFF2 size: 772,032 bytes; release asset budget: 800 kB.
- FontTools 4.59.2, Brotli 1.1.0; no font tooling is a runtime dependency.

This asset was restored byte-for-byte from Terax revision
`b501e217ec8ae90fe840a7090fd3920a80acb6aa`. Its hash and private-use-only
coverage were verified before packaging. No font generation tool is needed
to build this application.

The SIL Open Font License and Nerd Fonts notices accompany the source here and
ship in `public/licenses/terminal-symbols.txt`. Original copyright metadata is
retained in the font. One font face serves regular, bold, and italic fallback;
the webview synthesizes styles. It is loaded once before terminal rasterization
so an atlas cannot cache a missing-font glyph while the face is still loading.
