# Terminal symbols

Two private-use symbol faces back every terminal font. Both are subsets of the
Nerd Fonts glyphs in Ghostty's `JetBrainsMonoNerdFont-Regular.ttf` (Powerline,
Devicons, Seti, Codicons, Font Awesome, Font Logos, Octicons, Weather and Material
Design icons). Text and color emoji keep using the selected text font and the
platform fallback.

| Face | File | Codepoints | Glyphs | Size |
| --- | --- | --- | --- | --- |
| Terax Terminal Symbols | `terax-terminal-symbols.woff2` | U+E000-F8FF | 3,175 | 365,080 B |
| Terax Terminal Symbols MDI | `terax-terminal-symbols-mdi.woff2` | U+F0000-FFFFD | 6,896 | 349,072 B |

The first face loads with the first terminal. The MDI face (about 350 kB) loads
only when a glyph in U+F0000-FFFFD is first drawn, and the terminal rebuilds its
glyph atlas when it arrives. Neither is part of the startup graph: the
`@font-face` rules in `src/styles/fonts.css` fetch a file only on use.

Source: Ghostty revision `349f026087d948f8f898dca3231ff91438f83ab8`,
`src/font/res/JetBrainsMonoNerdFont-Regular.ttf` (SHA-256
`a2f4268a1719b95d1f1448376173a42317919cb598423f18ea327eaca13dd916`).

Derivation (FontTools 4.60, Brotli 1.1; no font tooling is a build or runtime
dependency): keep the codepoint ranges above, drop hinting, layout tables and
glyph names, rescale 1000 to 500 units per em (a point moves by at most 0.001 em), and rename the family. Advance widths stay one cell of
JetBrains Mono. One face serves regular, bold and italic; the webview
synthesizes styles. The rasterizer fits each icon to the terminal's cell
(`gpu/GlyphPlacement.ts`).

- `terax-terminal-symbols.woff2` SHA-256:
  `08107a419bbbc0d24ea11fdbae136bc7fa1943a0fc2b3495975a8b3082428081`
- `terax-terminal-symbols-mdi.woff2` SHA-256:
  `987533dfb02fd9f769dc199ffbf5f2bea02b9a102883eaa795fbebfacc10f4ac`

The SIL Open Font License and Nerd Fonts notices accompany the source here and
ship in `public/licenses/terminal-symbols.txt`. Original copyright metadata is
retained in both fonts.
