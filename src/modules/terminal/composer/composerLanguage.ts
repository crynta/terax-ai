import type { Extension } from "@codemirror/state";
import { resolveLanguage } from "@/modules/editor/lib/languageResolver";

export type ComposerSyntaxMode =
  | "bash"
  | "markdown"
  | "xml"
  | "json"
  | "yaml"
  | "python"
  | "javascript"
  | "typescript"
  | "html"
  | "css"
  | "sql"
  | "plain";

export type ComposerSyntaxModeOption = {
  id: ComposerSyntaxMode;
  label: string;
  extension: string | null;
};

export type ComposerSyntaxRule = {
  id: string;
  pattern: string;
  mode: ComposerSyntaxMode;
};

export const DEFAULT_COMPOSER_SYNTAX_MODE: ComposerSyntaxMode = "bash";

export const DEFAULT_COMPOSER_SYNTAX_RULES: ComposerSyntaxRule[] = [
  { id: "ai-cli", pattern: "claude|codex|gemini", mode: "markdown" },
];

export const COMPOSER_SYNTAX_MODES: ComposerSyntaxModeOption[] = [
  { id: "bash", label: "Bash", extension: "sh" },
  { id: "markdown", label: "Markdown", extension: "md" },
  { id: "xml", label: "XML", extension: "xml" },
  { id: "json", label: "JSON", extension: "json" },
  { id: "yaml", label: "YAML", extension: "yaml" },
  { id: "python", label: "Python", extension: "py" },
  { id: "javascript", label: "JavaScript", extension: "js" },
  { id: "typescript", label: "TypeScript", extension: "ts" },
  { id: "html", label: "HTML", extension: "html" },
  { id: "css", label: "CSS", extension: "css" },
  { id: "sql", label: "SQL", extension: "sql" },
  { id: "plain", label: "Plain text", extension: null },
];

const modeIds = new Set(COMPOSER_SYNTAX_MODES.map((mode) => mode.id));

export function resolveComposerSyntaxMode(value: unknown): ComposerSyntaxMode {
  return typeof value === "string" && modeIds.has(value as ComposerSyntaxMode)
    ? (value as ComposerSyntaxMode)
    : DEFAULT_COMPOSER_SYNTAX_MODE;
}

export function normalizeComposerSyntaxRules(
  value: unknown,
): ComposerSyntaxRule[] {
  if (!Array.isArray(value)) return DEFAULT_COMPOSER_SYNTAX_RULES;
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as { pattern?: unknown; mode?: unknown };
      const id =
        typeof (raw as { id?: unknown }).id === "string" &&
        (raw as { id?: string }).id?.trim()
          ? (raw as { id: string }).id.trim()
          : `composer-rule-${index}`;
      const pattern = typeof raw.pattern === "string" ? raw.pattern.trim() : "";
      return {
        id,
        pattern,
        mode: resolveComposerSyntaxMode(raw.mode),
      };
    })
    .filter((item): item is ComposerSyntaxRule => item !== null);
}

export function resolveComposerSyntaxModeForContext({
  agentName,
  defaultMode,
  rules,
}: {
  agentName: string | null;
  defaultMode: ComposerSyntaxMode;
  rules: ComposerSyntaxRule[];
}): ComposerSyntaxMode {
  if (!agentName) return defaultMode;
  for (const rule of rules) {
    if (matchesRule(rule.pattern, agentName)) return rule.mode;
  }
  return defaultMode;
}

export async function loadComposerSyntaxExtension(
  mode: ComposerSyntaxMode,
): Promise<Extension> {
  if (mode === "xml") {
    const { html } = await import("@codemirror/lang-html");
    return html({ selfClosingTags: true });
  }

  const option = COMPOSER_SYNTAX_MODES.find((item) => item.id === mode);
  if (!option?.extension) return [];
  const resolved = await resolveLanguage(`composer.${option.extension}`);
  return resolved?.ext ?? [];
}

function matchesRule(pattern: string, value: string): boolean {
  const needle = value.trim();
  const source = pattern.trim();
  if (!needle || !source) return false;
  try {
    return new RegExp(source, "i").test(needle);
  } catch {
    return needle.toLowerCase().includes(source.toLowerCase());
  }
}
