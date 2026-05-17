import { tags as t } from "@lezer/highlight";
import { createTheme, type CreateThemeOptions } from "@uiw/codemirror-themes";

const c = {
  background: "#2d2a2e",
  foreground: "#fcfcfa",
  caret: "#c1c0c0",
  selection: "#5b595c",
  selectionMatch: "#5b595c",
  activeLine: "#3a383c",
  gutterBackground: "#2d2a2e",
  gutterForeground: "#939293",
  keyword: "#ff6188",
  storage: "#ff6188",
  variable: "#fc9867",
  parameter: "#fc9867",
  function: "#a9dc76",
  string: "#ffd866",
  constant: "#ab9df2",
  type: "#78dce8",
  class: "#78dce8",
  number: "#ab9df2",
  comment: "#727072",
  heading: "#a9dc76",
  invalid: "#ff6188",
  regexp: "#ffd866",
  tag: "#ff6188",
  property: "#fc9867",
  operator: "#ff6188",
};

export const defaultSettingsMonokaiPro: CreateThemeOptions["settings"] = {
  background: c.background,
  foreground: c.foreground,
  caret: c.caret,
  selection: c.selection,
  selectionMatch: c.selectionMatch,
  gutterBackground: c.gutterBackground,
  gutterForeground: c.gutterForeground,
  lineHighlight: c.activeLine,
};

export const monokaiProStyle: CreateThemeOptions["styles"] = [
  { tag: t.keyword, color: c.keyword },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: c.variable },
  { tag: [t.propertyName], color: c.property },
  { tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)], color: c.string },
  { tag: [t.function(t.variableName), t.labelName], color: c.function },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: c.constant },
  { tag: [t.definition(t.name), t.separator], color: c.variable },
  { tag: [t.className], color: c.class },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: c.number },
  { tag: [t.typeName], color: c.type, fontStyle: c.type },
  { tag: [t.operator, t.operatorKeyword], color: c.operator },
  { tag: [t.url, t.escape, t.regexp, t.link], color: c.regexp },
  { tag: [t.meta, t.comment], color: c.comment },
  { tag: t.tagName, color: c.tag },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: c.heading },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: c.constant },
  { tag: t.invalid, color: c.invalid },
  { tag: t.strikethrough, textDecoration: "line-through" },
];

export const monokaiProInit = (options?: Partial<CreateThemeOptions>) => {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme: theme,
    settings: {
      ...defaultSettingsMonokaiPro,
      ...settings,
    },
    styles: [...monokaiProStyle, ...styles],
  });
};

export const monokaiPro = monokaiProInit();
