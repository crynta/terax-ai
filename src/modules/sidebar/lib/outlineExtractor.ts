import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type OutlineNode = {
  label: string;
  kind: "function" | "class" | "variable" | "heading" | "other";
  line: number;
  depth: number;
};

const PYTHON_FUNCTION_TYPES = new Set(["FunctionDefinition"]);
const PYTHON_CLASS_TYPES = new Set(["ClassDefinition"]);
const RUST_FUNCTION_TYPES = new Set(["FunctionItem"]);
const RUST_TYPE_TYPES = new Set(["StructItem", "EnumItem", "ImplItem"]);
const GO_FUNCTION_TYPES = new Set(["FunctionDecl", "MethodDecl"]);
const GO_TYPE_TYPES = new Set(["TypeDecl"]);

const JS_FUNC_DEPTH_NODES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
]);

type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = ReturnType<Tree["cursor"]>["node"];

function lineAt(state: EditorState, pos: number): number {
  return state.doc.lineAt(pos).number;
}

function nameFromNode(state: EditorState, node: SyntaxNode): string | null {
  const nameNode =
    node.getChild("VariableDefinition") ??
    node.getChild("TypeDefinition") ??
    node.getChild("PropertyDefinition");
  if (nameNode) return state.doc.sliceString(nameNode.from, nameNode.to);
  const ident = node.getChild("Identifier");
  if (ident) return state.doc.sliceString(ident.from, ident.to);
  return null;
}

function extractJsOutline(state: EditorState, parsed: Tree): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  // Track nesting depth so we stop descending into deeply nested callbacks
  // (handlers inside hooks, etc.), which would otherwise flood the outline.
  let funcDepth = 0;

  parsed.cursor().iterate(
    (node) => {
      if (funcDepth >= 2) return false;

      if (JS_FUNC_DEPTH_NODES.has(node.name)) {
        const nameNode = node.node.getChild("VariableDefinition");
        if (nameNode) {
          nodes.push({
            label: state.doc.sliceString(nameNode.from, nameNode.to),
            kind: "function",
            line: lineAt(state, node.from),
            depth: funcDepth,
          });
        }
        funcDepth++;
        return;
      }

      if (node.name === "ClassDeclaration" || node.name === "ClassExpression") {
        const nameNode = node.node.getChild("VariableDefinition");
        if (nameNode) {
          nodes.push({
            label: state.doc.sliceString(nameNode.from, nameNode.to),
            kind: "class",
            line: lineAt(state, node.from),
            depth: funcDepth,
          });
        }
      }

      if (
        node.name === "TypeAliasDeclaration" ||
        node.name === "InterfaceDeclaration"
      ) {
        const nameNode =
          node.node.getChild("TypeDefinition") ??
          node.node.getChild("Identifier");
        if (nameNode) {
          nodes.push({
            label: state.doc.sliceString(nameNode.from, nameNode.to),
            kind: "class",
            line: lineAt(state, node.from),
            depth: funcDepth,
          });
        }
      }

      // Lezer JS grammar exposes VariableDefinition as a direct child of
      // VariableDeclaration (no VariableDeclarator wrapper).
      if (node.name === "VariableDeclaration") {
        const nameNode = node.node.getChild("VariableDefinition");
        if (!nameNode) return;

        const label = state.doc.sliceString(nameNode.from, nameNode.to);

        if (funcDepth === 0) {
          // File scope: only surface declarations whose initializer is a
          // function — `const Foo = () => {}`, not `const MAX = 100`.
          let child = node.node.firstChild;
          while (child) {
            if (
              child.name === "ArrowFunction" ||
              child.name === "FunctionExpression"
            ) {
              nodes.push({
                label,
                kind: "function",
                line: lineAt(state, node.from),
                depth: 0,
              });
              break;
            }
            child = child.nextSibling;
          }
        } else if (funcDepth === 1) {
          nodes.push({
            label,
            kind: "variable",
            line: lineAt(state, node.from),
            depth: 1,
          });
        }
      }
    },
    (node) => {
      if (JS_FUNC_DEPTH_NODES.has(node.name)) funcDepth--;
    },
  );

  return nodes;
}

function extractFromTree(
  state: EditorState,
  parsed: Tree,
  ext: string,
): OutlineNode[] {
  if (ext === "md" || ext === "mdx") {
    const nodes: OutlineNode[] = [];
    parsed.cursor().iterate((node) => {
      if (!node.name.startsWith("ATXHeading")) return;
      const level = parseInt(node.name.replace("ATXHeading", ""), 10);
      if (!Number.isFinite(level)) return;
      const markEnd = node.node.firstChild?.to ?? node.from;
      const text = state.doc.sliceString(markEnd, node.to).trim();
      nodes.push({
        label: text,
        kind: "heading",
        line: lineAt(state, node.from),
        depth: level,
      });
    });
    return nodes;
  }

  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    return extractJsOutline(state, parsed);
  }

  const nodes: OutlineNode[] = [];
  parsed.cursor().iterate((node) => {
    if (ext === "py") {
      if (PYTHON_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) {
          nodes.push({
            label: name,
            kind: "function",
            line: lineAt(state, node.from),
            depth: 0,
          });
        }
      } else if (PYTHON_CLASS_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) {
          nodes.push({
            label: name,
            kind: "class",
            line: lineAt(state, node.from),
            depth: 0,
          });
        }
      }
    } else if (ext === "rs") {
      if (RUST_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) {
          nodes.push({
            label: name,
            kind: "function",
            line: lineAt(state, node.from),
            depth: 0,
          });
        }
      } else if (RUST_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) {
          nodes.push({
            label: name,
            kind: "class",
            line: lineAt(state, node.from),
            depth: 0,
          });
        }
      }
    } else if (ext === "go") {
      if (GO_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) {
          nodes.push({
            label: name,
            kind: "function",
            line: lineAt(state, node.from),
            depth: 0,
          });
        }
      } else if (GO_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) {
          nodes.push({
            label: name,
            kind: "class",
            line: lineAt(state, node.from),
            depth: 0,
          });
        }
      }
    }
  });
  return nodes;
}

const SUPPORTED_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rs",
  "go",
  "md",
  "mdx",
]);

export function extractOutlineFromView(
  view: EditorView,
  ext: string,
): OutlineNode[] {
  if (!SUPPORTED_EXTS.has(ext)) return [];
  return extractFromTree(view.state, syntaxTree(view.state), ext);
}

async function loadGrammar(ext: string): Promise<Extension | null> {
  switch (ext) {
    case "ts":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: true,
      });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: true,
        jsx: true,
      });
    case "js":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        jsx: true,
      });
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "go":
      return (await import("@codemirror/lang-go")).go();
    case "md":
    case "mdx":
      return (await import("@codemirror/lang-markdown")).markdown();
    default:
      return null;
  }
}

// Source-string variant used by tests. Runtime callers should use
// extractOutlineFromView, which reuses the editor's incremental parse.
export async function extractOutline(
  source: string,
  ext: string,
): Promise<OutlineNode[]> {
  const grammar = await loadGrammar(ext);
  if (!grammar) return [];
  const state = EditorState.create({ doc: source, extensions: [grammar] });
  const parsed =
    ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
  return extractFromTree(state, parsed, ext);
}
