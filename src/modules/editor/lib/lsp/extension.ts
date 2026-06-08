import { autocompletion, startCompletion, type CompletionContext } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { Extension, Range } from "@codemirror/state";
import { Prec, RangeSet, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  hoverTooltip,
  keymap,
  lineNumberMarkers,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";
import { lspDebugPatch, lspDebugPush } from "./debugStore";
import { acquireLspClient, releaseLspClient } from "./manager";
import type { LspEditorClient } from "./editorClient";
import { isExternalLibraryPath, sameFilePath } from "./protocol";
import { renderHoverDom } from "./hoverContent";

import type { LspRange } from "./protocol";

/** Push LSP diagnostics straight into CodeMirror — forceLinting is a no-op after lint settled. */
function pushLspDiagnostics(
  view: EditorView,
  getClient: () => LspEditorClient | null,
) {
  const diags: Diagnostic[] =
    getClient()?.getDiagnosticsForText(view.state.doc.toString()) ?? [];
  view.dispatch(setDiagnostics(view.state, diags));
}

function lspDiagnosticsPlugin(getClient: () => LspEditorClient | null) {
  return ViewPlugin.fromClass(
    class {
      private unsub: (() => void) | undefined;

      constructor(private view: EditorView) {
        const client = getClient();
        if (!client) return;
        const push = () => pushLspDiagnostics(this.view, getClient);
        this.unsub = client.onDiagnostics(push);
        push();
      }

      destroy() {
        this.unsub?.();
      }
    },
  );
}

class InactiveLineNumberMarker extends GutterMarker {
  elementClass = "cm-lsp-inactive-lineNumber";
  eq() {
    return true;
  }
}

const inactiveLineNumberMarker = new InactiveLineNumberMarker();

function buildInactiveVisuals(
  doc: { lines: number; line: (n: number) => { from: number } },
  regions: LspRange[],
): { lines: DecorationSet; numbers: RangeSet<GutterMarker> } {
  const lineDecos: Range<Decoration>[] = [];
  const numberRanges: Range<GutterMarker>[] = [];
  const seen = new Set<number>();

  for (const region of regions) {
    const start = region.start.line + 1;
    const end = region.end.line + 1;
    for (let ln = start; ln <= end && ln <= doc.lines; ln++) {
      if (seen.has(ln)) continue;
      seen.add(ln);
      const line = doc.line(ln);
      lineDecos.push(
        Decoration.line({ class: "cm-lsp-inactive-line" }).range(line.from),
      );
      numberRanges.push(inactiveLineNumberMarker.range(line.from));
    }
  }

  return {
    lines: lineDecos.length ? Decoration.set(lineDecos, true) : Decoration.none,
    numbers: numberRanges.length
      ? RangeSet.of(numberRanges, true)
      : RangeSet.empty,
  };
}

const refreshInactiveRegions = StateEffect.define<null>();

function inactiveRegionsPlugin(getClient: () => LspEditorClient | null) {
  const inactiveField = StateField.define<{
    lines: DecorationSet;
    numbers: RangeSet<GutterMarker>;
  }>({
    create() {
      return { lines: Decoration.none, numbers: RangeSet.empty };
    },
    update(value, tr) {
      let { lines, numbers } = value;
      lines = lines.map(tr.changes);
      numbers = numbers.map(tr.changes);
      if (
        tr.docChanged ||
        tr.effects.some((e) => e.is(refreshInactiveRegions))
      ) {
        const client = getClient();
        const regions = client?.getInactiveRegions() ?? [];
        return buildInactiveVisuals(tr.state.doc, regions);
      }
      return { lines, numbers };
    },
    provide: (field) => [
      EditorView.decorations.compute([field], (s) => s.field(field).lines),
      lineNumberMarkers.compute([field], (s) => s.field(field).numbers),
    ],
  });

  const plugin = ViewPlugin.fromClass(
    class {
      private unsub: (() => void) | undefined;

      constructor(private view: EditorView) {
        const client = getClient();
        if (!client) return;
        const push = () =>
          this.view.dispatch({ effects: refreshInactiveRegions.of(null) });
        this.unsub = client.onDiagnostics(push);
        push();
      }

      destroy() {
        this.unsub?.();
      }
    },
  );

  return [inactiveField, plugin];
}

function lspChangePlugin(getClient: () => LspEditorClient | null) {
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        const client = getClient();
        if (!client) return;
        const text = update.state.doc.toString();
        client.scheduleChange(text);

        if (update.transactions.some((tr) => tr.isUserEvent("input.type"))) {
          const pos = update.state.selection.main.head;
          const before = text.slice(0, pos);
          if (isAfterTriggerChar(before)) {
            startCompletion(update.view);
          }
        }
      }
    },
    {
      eventHandlers: {
        blur(_event, view) {
          const client = getClient();
          if (!client) return;
          client.scheduleChange(view.state.doc.toString());
        },
      },
    },
  );
}

function isAfterTriggerChar(before: string): boolean {
  return (
    before.endsWith("::") ||
    before.endsWith(".") ||
    before.endsWith("(") ||
    before.endsWith("#") ||
    before.endsWith("'") ||
    before.endsWith('"')
  );
}

function completionDelay(context: CompletionContext, text: string): number {
  if (context.explicit) return 0;
  const before = text.slice(0, context.pos);
  if (isAfterTriggerChar(before)) return 0;
  return 40;
}

function lspCompletion(getClient: () => LspEditorClient | null) {
  return autocompletion({
    activateOnTyping: true,
    defaultKeymap: true,
    maxRenderedOptions: 24,
    icons: true,
    override: [
      (context) =>
        new Promise((resolve) => {
          const client = getClient();
          if (!client) {
            resolve(null);
            return;
          }
          const text = context.state.doc.toString();
          const delay = completionDelay(context, text);
          const run = async () => {
            if (context.aborted) {
              resolve(null);
              return;
            }
            try {
              const result = await client.completionAt(context, text);
              resolve(context.aborted ? null : result);
            } catch {
              resolve(null);
            }
          };
          if (delay === 0) void run();
          else setTimeout(run, delay);
        }),
    ],
  });
}

function goToLspPosition(view: EditorView, line: number, character: number) {
  const lineNum = Math.min(Math.max(1, line), view.state.doc.lines);
  const lineObj = view.state.doc.line(lineNum);
  const pos = Math.min(lineObj.from + character, lineObj.to);
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "center" }),
  });
  view.focus();
}

function lspHover(getClient: () => LspEditorClient | null) {
  return hoverTooltip(
    async (view, pos, side) => {
      const client = getClient();
      if (!client) return null;
      const text = view.state.doc.toString();
      const hoverBlocks = await client.hoverAt(pos, text);
      if (!hoverBlocks?.length) return null;
      return {
        pos,
        above: side === -1,
        create() {
          return { dom: renderHoverDom(hoverBlocks) };
        },
      };
    },
    { hoverTime: 350 },
  );
}

const setDefinitionLink = StateEffect.define<{ from: number; to: number } | null>();

const definitionLinkField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decs, tr) {
    decs = decs.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setDefinitionLink)) {
        if (!effect.value) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-lsp-definition-link" }).range(
            effect.value.from,
            effect.value.to,
          ),
        ]);
      }
    }
    return decs;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function lspDefinitionLinkHighlight(getClient: () => LspEditorClient | null) {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;
      lastPos = -1;

      constructor(readonly view: EditorView) {}

      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }

      clearLink() {
        this.lastPos = -1;
        this.view.dispatch({ effects: setDefinitionLink.of(null) });
      }

      schedule(pos: number) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.refresh(pos);
        }, 80);
      }

      async refresh(pos: number) {
        const client = getClient();
        if (!client) {
          this.clearLink();
          return;
        }
        try {
          const text = this.view.state.doc.toString();
          const range = await client.linkableRangeAt(pos, text);
          if (range) {
            this.view.dispatch({ effects: setDefinitionLink.of(range) });
          } else {
            this.clearLink();
          }
        } catch {
          this.clearLink();
        }
      }

      onMouseMove(event: MouseEvent, view: EditorView) {
        if (!event.ctrlKey && !event.metaKey) {
          if (this.lastPos !== -1) this.clearLink();
          return;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) {
          this.clearLink();
          return;
        }
        if (pos === this.lastPos) return;
        this.lastPos = pos;
        this.schedule(pos);
      }
    },
    {
      eventHandlers: {
        mousemove(event, view) {
          this.onMouseMove(event, view);
          return false;
        },
        keydown(event) {
          if (!event.ctrlKey && !event.metaKey) this.clearLink();
          return false;
        },
        mouseleave() {
          this.clearLink();
          return false;
        },
      },
    },
  );
}

async function navigateDefinition(
  view: EditorView,
  path: string,
  pos: number,
  getClient: () => LspEditorClient | null,
  onOpenDefinition?: (path: string, line: number) => void,
) {
  const client = getClient();
  if (!client) return;
  const text = view.state.doc.toString();
  try {
    const target = await client.definitionAt(pos, text);
    if (!target) return;
    if (sameFilePath(target.path, path)) {
      goToLspPosition(view, target.line, target.character);
      return;
    }
    if (isExternalLibraryPath(target.path)) {
      onOpenDefinition?.(target.path, target.line);
      return;
    }
    onOpenDefinition?.(target.path, target.line);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lspDebugPush("error", "definition failed", message);
  }
}

function lspDefinitionKeymap(
  path: string,
  getClient: () => LspEditorClient | null,
  onOpenDefinition?: (path: string, line: number) => void,
) {
  return keymap.of([
    {
      key: "F12",
      run: (view) => {
        const pos = view.state.selection.main.head;
        void navigateDefinition(view, path, pos, getClient, onOpenDefinition);
        return true;
      },
    },
  ]);
}

function lspDefinition(
  path: string,
  getClient: () => LspEditorClient | null,
  onOpenDefinition?: (path: string, line: number) => void,
): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return false;
      const client = getClient();
      if (!client) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      event.preventDefault();
      void navigateDefinition(view, path, pos, getClient, onOpenDefinition);
      return true;
    },
  });
}

class InlayHintWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: InlayHintWidget) {
    return other.label === this.label;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lsp-inlay-hint";
    span.textContent = this.label;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

const setInlayHints = StateEffect.define<DecorationSet>();

function buildInlayDecorations(
  hints: Array<{ pos: number; label: string }>,
  docLen: number,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const hint of hints) {
    if (!hint.label) continue;
    const pos = Math.max(0, Math.min(hint.pos, docLen));
    ranges.push(
      Decoration.widget({
        widget: new InlayHintWidget(hint.label),
        side: 1,
      }).range(pos),
    );
  }
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

function lspInlayHintsPlugin(getClient: () => LspEditorClient | null) {
  const inlayField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decs, tr) {
      decs = decs.map(tr.changes);
      for (const effect of tr.effects) {
        if (effect.is(setInlayHints)) return effect.value;
      }
      return decs;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const plugin = ViewPlugin.fromClass(
    class {
      private unsubDiag: (() => void) | undefined;
      private unsubInlay: (() => void) | undefined;
      private timer: ReturnType<typeof setTimeout> | null = null;
      private fetchId = 0;

      constructor(private view: EditorView) {
        const client = getClient();
        if (!client?.hasInlayHints()) return;
        const schedule = () => this.scheduleRefresh();
        this.unsubDiag = client.onDiagnostics(schedule);
        this.unsubInlay = client.onInlayHints(schedule);
        schedule();
      }

      destroy() {
        if (this.timer) clearTimeout(this.timer);
        this.unsubDiag?.();
        this.unsubInlay?.();
      }

      scheduleRefresh() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.refresh();
        }, 200);
      }

      async refresh() {
        const client = getClient();
        if (!client?.hasInlayHints()) {
          this.view.dispatch({ effects: setInlayHints.of(Decoration.none) });
          return;
        }
        const fetchId = ++this.fetchId;
        const text = this.view.state.doc.toString();
        try {
          const hints = await client.inlayHintsAt(text);
          if (fetchId !== this.fetchId) return;
          const decos = buildInlayDecorations(hints, text.length);
          this.view.dispatch({ effects: setInlayHints.of(decos) });
        } catch {
          if (fetchId !== this.fetchId) return;
          this.view.dispatch({ effects: setInlayHints.of(Decoration.none) });
        }
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        const client = getClient();
        if (!client?.hasInlayHints()) return;
        this.scheduleRefresh();
      }
    },
  );

  return [inlayField, plugin];
}

export type AttachLspOptions = {
  path: string;
  initialText: string;
  onOpenDefinition?: (path: string, line: number) => void;
};

export async function buildLspExtensions(
  opts: AttachLspOptions,
): Promise<{ extensions: Extension[]; release: () => Promise<void> } | null> {
  lspDebugPush("info", "attach LSP", opts.path);
  try {
    const client = await acquireLspClient(opts.path, opts.initialText);
    if (!client) {
      lspDebugPush("warn", "LSP extensions skipped", opts.path);
      return null;
    }
    lspDebugPush("info", "LSP extensions active", opts.path);

    let current: LspEditorClient | null = client;
    const getClient = () => current;

    const extensions: Extension[] = [
      definitionLinkField,
      lspDiagnosticsPlugin(getClient),
      ...inactiveRegionsPlugin(getClient),
      ...lspInlayHintsPlugin(getClient),
      lspChangePlugin(getClient),
      Prec.highest(lspCompletion(getClient)),
      lspHover(getClient),
      lspDefinitionLinkHighlight(getClient),
      lspDefinition(opts.path, getClient, opts.onOpenDefinition),
      lspDefinitionKeymap(opts.path, getClient, opts.onOpenDefinition),
    ];

    return {
      extensions,
      release: async () => {
        current = null;
        await releaseLspClient(opts.path);
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lspDebugPush("error", "attach failed", message);
    lspDebugPatch({ state: "error", error: message });
    return null;
  }
}
