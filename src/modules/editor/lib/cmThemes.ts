import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

// Syntax palette shared by every locally-defined theme. The editor renders as
// glass over the app surface, so `background`/`selection`/`caret` here are
// overridden by buildSharedExtensions() — only the syntax colors really land.
type Palette = {
  mode: "light" | "dark";
  bg: string;
  fg: string;
  caret: string;
  selection: string;
  lineHighlight: string;
  gutterFg: string;
  comment: string;
  keyword: string;
  boldKeyword?: boolean;
  string: string;
  number: string;
  /** Booleans / language constants / atoms. Falls back to `number`. */
  constant?: string;
  func: string;
  variable: string;
  property: string;
  type: string;
  operator: string;
  tag: string;
  attr: string;
  heading: string;
  link: string;
  invalid: string;
};

function build(p: Palette): Extension {
  return createTheme({
    theme: p.mode,
    settings: {
      background: p.bg,
      foreground: p.fg,
      caret: p.caret,
      selection: p.selection,
      selectionMatch: p.selection,
      lineHighlight: p.lineHighlight,
      gutterBackground: p.bg,
      gutterForeground: p.gutterFg,
    },
    styles: [
      { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: p.comment, fontStyle: "italic" },
      {
        tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.moduleKeyword, t.self],
        color: p.keyword,
        ...(p.boldKeyword ? { fontWeight: "bold" } : {}),
      },
      { tag: [t.string, t.special(t.string), t.regexp, t.character], color: p.string },
      { tag: [t.number], color: p.number },
      { tag: [t.bool, t.null, t.atom, t.constant(t.name)], color: p.constant ?? p.number },
      { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName, t.macroName], color: p.func },
      { tag: [t.definition(t.variableName), t.variableName, t.local(t.variableName)], color: p.variable },
      { tag: [t.propertyName, t.special(t.propertyName)], color: p.property },
      { tag: [t.typeName, t.className, t.namespace, t.changed, t.annotation], color: p.type },
      { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator], color: p.operator },
      { tag: [t.tagName, t.angleBracket], color: p.tag },
      { tag: [t.attributeName, t.attributeValue], color: p.attr },
      { tag: [t.heading], color: p.heading, fontWeight: "bold" },
      { tag: [t.link, t.url], color: p.link, textDecoration: "underline" },
      { tag: [t.emphasis], fontStyle: "italic" },
      { tag: [t.strong], fontWeight: "bold" },
      { tag: [t.invalid], color: p.invalid },
      { tag: [t.meta, t.processingInstruction], color: p.comment },
    ],
  });
}

export const kanagawa = build({
  mode: "dark",
  bg: "#1f1f28", fg: "#dcd7ba", caret: "#c8c093", selection: "#223249",
  lineHighlight: "#2a2a37", gutterFg: "#54546d",
  comment: "#727169", keyword: "#957fb8", boldKeyword: true, string: "#98bb6c",
  number: "#d27e99", constant: "#ffa066",
  func: "#7e9cd8", variable: "#dcd7ba", property: "#e6c384", type: "#7aa89f",
  operator: "#c0a36e", tag: "#e46876", attr: "#7fb4ca", heading: "#7e9cd8",
  link: "#7fb4ca", invalid: "#e82424",
});

export const kanagawaLotus = build({
  mode: "light",
  bg: "#f2ecbc", fg: "#545464", caret: "#43436c", selection: "#dcd5ac",
  lineHighlight: "#e5ddb0", gutterFg: "#8a8980",
  comment: "#8a8980", keyword: "#624c83", boldKeyword: true, string: "#6f894e",
  number: "#b35b79", constant: "#cc6d00",
  func: "#4d699b", variable: "#545464", property: "#836f4a", type: "#597b75",
  operator: "#5a5a72", tag: "#c84053", attr: "#4d699b", heading: "#4d699b",
  link: "#4e8ca2", invalid: "#c84053",
});

export const kanagawaDragon = build({
  mode: "dark",
  bg: "#181616", fg: "#c5c9c5", caret: "#c5c9c5", selection: "#223249",
  lineHighlight: "#282727", gutterFg: "#54544f",
  comment: "#737c73", keyword: "#957fb8", boldKeyword: true, string: "#87a987",
  number: "#a292a3", constant: "#b6927b",
  func: "#8ba4b0", variable: "#c5c9c5", property: "#c4b28a", type: "#8ea4a2",
  operator: "#c4746e", tag: "#c4746e", attr: "#8ba4b0", heading: "#8ba4b0",
  link: "#8ea4a2", invalid: "#e46876",
});

export const everforestDark = build({
  mode: "dark",
  bg: "#2d353b", fg: "#d3c6aa", caret: "#d3c6aa", selection: "#4c3743",
  lineHighlight: "#343f44", gutterFg: "#7a8478",
  comment: "#859289", keyword: "#e67e80", string: "#a7c080", number: "#d699b6",
  func: "#a7c080", variable: "#d3c6aa", property: "#83c092", type: "#dbbc7f",
  operator: "#e69875", tag: "#e67e80", attr: "#dbbc7f", heading: "#a7c080",
  link: "#7fbbb3", invalid: "#e67e80",
});

export const everforestLight = build({
  mode: "light",
  bg: "#fdf6e3", fg: "#5c6a72", caret: "#5c6a72", selection: "#e6e2cc",
  lineHighlight: "#efebd4", gutterFg: "#a6b0a0",
  comment: "#939f91", keyword: "#f85552", string: "#8da101", number: "#df69ba",
  func: "#8da101", variable: "#5c6a72", property: "#35a77c", type: "#dfa000",
  operator: "#f57d26", tag: "#f85552", attr: "#dfa000", heading: "#8da101",
  link: "#3a94c5", invalid: "#f85552",
});

export const dracula = build({
  mode: "dark",
  bg: "#282a36", fg: "#f8f8f2", caret: "#f8f8f0", selection: "#44475a",
  lineHighlight: "#343746", gutterFg: "#6272a4",
  comment: "#6272a4", keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9",
  func: "#50fa7b", variable: "#f8f8f2", property: "#8be9fd", type: "#8be9fd",
  operator: "#ff79c6", tag: "#ff79c6", attr: "#50fa7b", heading: "#bd93f9",
  link: "#8be9fd", invalid: "#ff5555",
});

export const solarizedDark = build({
  mode: "dark",
  bg: "#002b36", fg: "#839496", caret: "#839496", selection: "#073642",
  lineHighlight: "#073642", gutterFg: "#586e75",
  comment: "#586e75", keyword: "#859900", string: "#2aa198", number: "#d33682",
  func: "#268bd2", variable: "#839496", property: "#268bd2", type: "#b58900",
  operator: "#859900", tag: "#268bd2", attr: "#93a1a1", heading: "#cb4b16",
  link: "#6c71c4", invalid: "#dc322f",
});

export const solarizedLight = build({
  mode: "light",
  bg: "#fdf6e3", fg: "#657b83", caret: "#657b83", selection: "#eee8d5",
  lineHighlight: "#eee8d5", gutterFg: "#93a1a1",
  comment: "#93a1a1", keyword: "#859900", string: "#2aa198", number: "#d33682",
  func: "#268bd2", variable: "#657b83", property: "#268bd2", type: "#b58900",
  operator: "#859900", tag: "#268bd2", attr: "#586e75", heading: "#cb4b16",
  link: "#6c71c4", invalid: "#dc322f",
});

export const catppuccinMocha = build({
  mode: "dark",
  bg: "#1e1e2e", fg: "#cdd6f4", caret: "#f5e0dc", selection: "#45475a",
  lineHighlight: "#313244", gutterFg: "#6c7086",
  comment: "#6c7086", keyword: "#cba6f7", string: "#a6e3a1", number: "#fab387",
  func: "#89b4fa", variable: "#cdd6f4", property: "#89b4fa", type: "#f9e2af",
  operator: "#89dceb", tag: "#f38ba8", attr: "#fab387", heading: "#f38ba8",
  link: "#89b4fa", invalid: "#f38ba8",
});

export const catppuccinLatte = build({
  mode: "light",
  bg: "#eff1f5", fg: "#4c4f69", caret: "#dc8a78", selection: "#ccced7",
  lineHighlight: "#e6e9ef", gutterFg: "#8c8fa1",
  comment: "#8c8fa1", keyword: "#8839ef", string: "#40a02b", number: "#fe640b",
  func: "#1e66f5", variable: "#4c4f69", property: "#1e66f5", type: "#df8e1d",
  operator: "#04a5e5", tag: "#d20f39", attr: "#fe640b", heading: "#d20f39",
  link: "#1e66f5", invalid: "#d20f39",
});

export const rosePine = build({
  mode: "dark",
  bg: "#191724", fg: "#e0def4", caret: "#e0def4", selection: "#403d52",
  lineHighlight: "#1f1d2e", gutterFg: "#6e6a86",
  comment: "#6e6a86", keyword: "#31748f", string: "#f6c177", number: "#ebbcba",
  func: "#ebbcba", variable: "#e0def4", property: "#9ccfd8", type: "#9ccfd8",
  operator: "#908caa", tag: "#9ccfd8", attr: "#ebbcba", heading: "#c4a7e7",
  link: "#c4a7e7", invalid: "#eb6f92",
});

export const rosePineDawn = build({
  mode: "light",
  bg: "#faf4ed", fg: "#575279", caret: "#575279", selection: "#dfdad9",
  lineHighlight: "#f2e9e1", gutterFg: "#9893a5",
  comment: "#9893a5", keyword: "#286983", string: "#ea9d34", number: "#d7827e",
  func: "#d7827e", variable: "#575279", property: "#56949f", type: "#56949f",
  operator: "#797593", tag: "#56949f", attr: "#d7827e", heading: "#907aa9",
  link: "#907aa9", invalid: "#b4637a",
});
