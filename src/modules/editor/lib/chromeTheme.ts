import { detectMonoFontFamily } from "@/lib/fonts";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

type IconGroup = "fn" | "val" | "type" | "iface" | "misc";
type ThemeSpec = Parameters<typeof EditorView.theme>[0];

const ICONS: [kind: string, glyph: string, group: IconGroup][] = [
  ["function", "ƒ", "fn"],
  ["method", "ƒ", "fn"],
  ["constructor", "ƒ", "fn"],
  ["variable", "x", "val"],
  ["property", "p", "val"],
  ["field", "f", "val"],
  ["class", "C", "type"],
  ["struct", "S", "type"],
  ["enum", "E", "type"],
  ["enummember", "e", "type"],
  ["event", "e", "type"],
  ["interface", "I", "iface"],
  ["type", "T", "iface"],
  ["typeparameter", "T", "iface"],
  ["namespace", "N", "iface"],
  ["module", "M", "iface"],
  ["keyword", "k", "misc"],
  ["constant", "c", "misc"],
  ["snippet", "s", "misc"],
  ["text", "t", "misc"],
  ["unit", "u", "misc"],
  ["value", "=", "misc"],
  ["operator", "±", "misc"],
  ["reference", "r", "misc"],
  ["file", "□", "misc"],
  ["folder", "▸", "misc"],
  ["color", "●", "misc"],
];

const GROUP_COLORS: Record<IconGroup, { light: string; dark: string }> = {
  fn: { light: "#7c3aed", dark: "#c084fc" },
  val: { light: "#2563eb", dark: "#75beff" },
  type: { light: "#d97706", dark: "#ee9d28" },
  iface: { light: "#0d9488", dark: "#2dd4bf" },
  misc: { light: "#6b7280", dark: "#9ca3af" },
};

const SEVERITY_COLORS = {
  error: { light: "var(--destructive)", dark: "var(--destructive)" },
  warning: { light: "#b45309", dark: "#fbbf24" },
  info: { light: "#2563eb", dark: "#60a5fa" },
  hint: { light: "#6b7280", dark: "#9ca3af" },
} as const;

function iconRules(mode: "light" | "dark"): ThemeSpec {
  const rules: ThemeSpec = {};
  for (const [kind, glyph, group] of ICONS) {
    const color = GROUP_COLORS[group][mode];
    rules[`.cm-completionIcon-${kind}`] = {
      backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
      color,
      "&:after": { content: `'${glyph}'` },
    };
  }
  return rules;
}

function lintRules(mode: "light" | "dark"): ThemeSpec {
  const rules: ThemeSpec = {};
  for (const [severity, colors] of Object.entries(SEVERITY_COLORS)) {
    const color = colors[mode];
    rules[`.cm-lintRange-${severity}`] = {
      backgroundImage: "none",
      textDecoration: `underline wavy ${color}`,
      textDecorationThickness: "1px",
      textUnderlineOffset: "4px",
    };
    rules[`.cm-diagnostic-${severity}`] = {
      borderLeft: `3px solid ${color}`,
    };
  }
  return rules;
}

function modeTheme(mode: "light" | "dark"): Extension {
  return EditorView.theme(
    { ...iconRules(mode), ...lintRules(mode) },
    { dark: mode === "dark" },
  );
}

const TOOLTIP_ENTER = {
  animation:
    "cm-tooltip-enter var(--dur-fast, 120ms) var(--ease-premium, ease-out)",
};

const chrome = EditorView.theme({
  "@keyframes cm-tooltip-enter": {
    from: { opacity: 0, transform: "scale(0.98) translateY(2px)" },
    to: { opacity: 1, transform: "scale(1) translateY(0)" },
  },

  ".cm-tooltip": {
    backgroundColor: "color-mix(in srgb, var(--popover) 94%, transparent)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow:
      "0 8px 24px color-mix(in srgb, black 18%, transparent), 0 2px 6px color-mix(in srgb, black 10%, transparent)",
    backdropFilter: "blur(12px)",
    overflow: "hidden",
    ...TOOLTIP_ENTER,
  },

  ".cm-tooltip .documentation": {
    padding: "8px 10px",
    maxWidth: "420px",
    maxHeight: "320px",
    overflowY: "auto",
    fontSize: "12px",
    lineHeight: "1.55",
    fontFamily: "inherit",
    "& p": { margin: "0 0 6px 0" },
    "& p:last-child": { margin: "0" },
    "& a": { color: "var(--primary)" },
    "& h1, & h2, & h3, & h4": {
      fontSize: "12px",
      fontWeight: "600",
      margin: "8px 0 4px 0",
    },
    "& ul, & ol": { margin: "4px 0", paddingLeft: "18px" },
    "& code": {
      fontFamily: detectMonoFontFamily(),
      fontSize: "11px",
      backgroundColor: "color-mix(in srgb, var(--muted) 70%, transparent)",
      borderRadius: "4px",
      padding: "1px 4px",
    },
    "& pre": {
      fontFamily: detectMonoFontFamily(),
      fontSize: "11px",
      backgroundColor: "color-mix(in srgb, var(--muted) 70%, transparent)",
      border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
      borderRadius: "6px",
      padding: "6px 8px",
      margin: "6px 0",
      overflowX: "auto",
      "& code": {
        backgroundColor: "transparent",
        padding: "0",
        borderRadius: "0",
      },
    },
  },

  ".cm-tooltip.cm-tooltip-autocomplete": {
    padding: "4px",
    "& > ul": {
      fontFamily: detectMonoFontFamily(),
      fontSize: "12px",
      maxHeight: "246px",
      minWidth: "220px",
      maxWidth: "460px",
    },
    "& > ul > li": {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "3px 6px",
      borderRadius: "5px",
      lineHeight: "1.4",
    },
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
  },
  ".cm-completionLabel": {
    flex: "0 1 auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--primary)",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "12px",
    fontStyle: "normal",
    fontSize: "10.5px",
    color: "var(--muted-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "40%",
  },
  ".cm-completionIcon": {
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    flexShrink: "0",
    borderRadius: "4px",
    fontSize: "10px",
    fontWeight: "600",
    opacity: "1",
    padding: "0",
    "&:after": { verticalAlign: "baseline" },
  },
  ".cm-tooltip.cm-completionInfo": {
    padding: "0",
    marginLeft: "6px",
    marginRight: "6px",
  },

  ".cm-tooltip-lint": {
    padding: "0",
  },
  ".cm-diagnostic": {
    padding: "6px 10px",
    fontSize: "12px",
    lineHeight: "1.5",
    fontFamily: "inherit",
  },
  ".cm-diagnostic:not(:last-child)": {
    borderBottom:
      "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
  },
  ".cm-diagnosticSource": {
    fontSize: "10px",
    color: "var(--muted-foreground)",
    opacity: "1",
    marginTop: "2px",
  },
  ".cm-lint-marker": { display: "none" },

  ".cm-lsp-rename-panel": {
    display: "flex",
    gap: "6px",
    padding: "6px 8px",
    backgroundColor: "var(--popover)",
    borderTop: "1px solid var(--border)",
  },
  ".cm-lsp-rename-input": {
    flex: "1",
    fontFamily: detectMonoFontFamily(),
    fontSize: "12px",
    backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "3px 8px",
    outline: "none",
    "&:focus": {
      borderColor: "color-mix(in srgb, var(--ring) 60%, var(--border))",
    },
  },

  ".cm-tooltip ::-webkit-scrollbar": { width: "8px", height: "8px" },
  ".cm-tooltip ::-webkit-scrollbar-thumb": {
    backgroundColor:
      "color-mix(in srgb, var(--muted-foreground) 30%, transparent)",
    borderRadius: "4px",
    backgroundClip: "padding-box",
    border: "2px solid transparent",
  },
  ".cm-tooltip ::-webkit-scrollbar-track": { background: "transparent" },
});

export function chromeTheme(): Extension {
  return [chrome, modeTheme("light"), modeTheme("dark")];
}
