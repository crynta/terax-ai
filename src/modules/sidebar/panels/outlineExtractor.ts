import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { go } from "@codemirror/lang-go";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export type OutlineNode = {
  label: string;
  kind: "function" | "class" | "variable" | "heading" | "other";
  line: number;
  depth: number;
};

// Maps file extension → grammar factory
const EXT_TO_GRAMMAR: Record<string, () => import("@codemirror/state").Extension> = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  py: () => python(),
  rs: () => rust(),
  go: () => go(),
  md: () => markdown(),
  mdx: () => markdown(),
};

function grammarFor(ext: string): (() => import("@codemirror/state").Extension) | null {
  return EXT_TO_GRAMMAR[ext.toLowerCase()] ?? null;
}

// Node type names to treat as declarations
const JS_FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
  "MethodDefinition",
]);
const JS_CLASS_TYPES = new Set(["ClassDeclaration", "ClassExpression"]);
const PYTHON_FUNCTION_TYPES = new Set(["FunctionDefinition"]);
const PYTHON_CLASS_TYPES = new Set(["ClassDefinition"]);
const RUST_FUNCTION_TYPES = new Set(["FunctionItem"]);
const RUST_TYPE_TYPES = new Set(["StructItem", "EnumItem", "ImplItem"]);
const GO_FUNCTION_TYPES = new Set(["FunctionDecl", "MethodDecl"]);
const GO_TYPE_TYPES = new Set(["TypeDecl"]);

function lineAt(state: EditorState, pos: number): number {
  return state.doc.lineAt(pos).number;
}

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["cursor"]>["node"];

function nameFromNode(
  state: EditorState,
  node: SyntaxNode,
): string | null {
  const nameNode =
    node.getChild("VariableDefinition") ??
    node.getChild("TypeDefinition") ??
    node.getChild("PropertyDefinition");
  if (nameNode) return state.doc.sliceString(nameNode.from, nameNode.to);
  const ident = node.getChild("Identifier");
  if (ident) return state.doc.sliceString(ident.from, ident.to);
  return null;
}

export function extractOutline(source: string, ext: string): OutlineNode[] {
  const grammar = grammarFor(ext);
  if (!grammar) return [];

  const state = EditorState.create({ doc: source, extensions: [grammar()] });
  const parsed = syntaxTree(state);
  const nodes: OutlineNode[] = [];

  const isMarkdown = ext === "md" || ext === "mdx";
  const isJS = ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx";
  const isPython = ext === "py";
  const isRust = ext === "rs";
  const isGo = ext === "go";

  if (isMarkdown) {
    parsed.cursor().iterate((node) => {
      if (!node.name.startsWith("ATXHeading")) return;
      const level = parseInt(node.name.replace("ATXHeading", ""), 10);
      if (!Number.isFinite(level)) return;
      const markEnd = node.node.firstChild?.to ?? node.from;
      const text = state.doc.sliceString(markEnd, node.to).trim();
      nodes.push({ label: text, kind: "heading", line: lineAt(state, node.from), depth: level });
    });
    return nodes;
  }

  parsed.cursor().iterate((node) => {
    if (isJS) {
      if (JS_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (JS_CLASS_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (isPython) {
      if (PYTHON_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (PYTHON_CLASS_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (isRust) {
      if (RUST_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (RUST_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (isGo) {
      if (GO_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (GO_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name)
          nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    }
  });

  return nodes;
}
