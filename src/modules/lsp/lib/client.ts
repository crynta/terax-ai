import type { Extension, Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  LanguageServerClient,
  languageServerPlugin,
  renameSymbol,
} from "codemirror-languageserver";

export {
  languageServerWithTransport,
  SynchronizationMethod,
} from "codemirror-languageserver";

type LspPos = { line: number; character: number };
type LspRange = { start: LspPos };

function offsetOf(doc: Text, pos: LspPos): number {
  if (pos.line >= doc.lines) return doc.length;
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + pos.character, line.to);
}

// The lib's formatDocument command fires and forgets; save needs to await
// the edits before writing to disk.
export async function formatDocumentAndWait(
  view: EditorView,
): Promise<boolean> {
  const plugin = view.plugin(languageServerPlugin);
  if (!plugin) return false;
  const { client } = plugin;
  if (!client.ready || !client.capabilities?.documentFormattingProvider) {
    return false;
  }
  const doc = view.state.doc;
  const edits = await client.textDocumentFormatting({
    textDocument: { uri: plugin.documentUri },
    options: { tabSize: view.state.tabSize, insertSpaces: true },
  });
  if (!edits || edits.length === 0) return false;
  // Edits are offsets into the requested snapshot; typing during the
  // round-trip would corrupt the document.
  if (view.state.doc !== doc) return false;
  view.dispatch({
    changes: edits.map((e) => ({
      from: offsetOf(doc, e.range.start),
      to: offsetOf(doc, e.range.end),
      insert: e.newText,
    })),
  });
  return true;
}

export function lspInteractions(opts: {
  client: TeraxLspClient;
  documentUri: string;
  onExternal: (uri: string, line: number) => void;
}): Extension {
  const gotoDefinition = async (
    view: EditorView,
    pos: number,
  ): Promise<void> => {
    const line = view.state.doc.lineAt(pos);
    let result: Awaited<
      ReturnType<LanguageServerClient["textDocumentDefinition"]>
    >;
    try {
      result = await opts.client.textDocumentDefinition({
        textDocument: { uri: opts.documentUri },
        position: { line: line.number - 1, character: pos - line.from },
      });
    } catch {
      return;
    }
    const loc = Array.isArray(result) ? result[0] : result;
    if (!loc) return;
    const uri = "uri" in loc ? loc.uri : loc.targetUri;
    const range: LspRange | undefined =
      "range" in loc
        ? loc.range
        : (loc.targetSelectionRange ?? loc.targetRange);
    if (!uri || !range) return;
    if (uri === opts.documentUri) {
      const targetLine = Math.min(range.start.line + 1, view.state.doc.lines);
      const target = Math.min(
        view.state.doc.line(targetLine).from + range.start.character,
        view.state.doc.length,
      );
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "center" }),
      });
      view.focus();
    } else {
      opts.onExternal(uri, range.start.line + 1);
    }
  };

  return [
    keymap.of([
      {
        key: "F12",
        preventDefault: true,
        run: (view) => {
          void gotoDefinition(view, view.state.selection.main.head);
          return true;
        },
      },
      {
        key: "F2",
        preventDefault: true,
        run: renameSymbol,
      },
      {
        key: "Shift-Alt-f",
        preventDefault: true,
        run: (view) => {
          void formatDocumentAndWait(view);
          return true;
        },
      },
    ]),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        void gotoDefinition(view, pos);
        return true;
      },
    }),
  ];
}

type RawRpc = {
  notify(method: string, params: unknown): Promise<void>;
  request(method: string, params: unknown, timeout: number): Promise<unknown>;
};

// The lib's notify/request maps omit didClose, didSave and the
// shutdown/exit handshake; servers need all three for correct lifecycle.
export class TeraxLspClient extends LanguageServerClient {
  static hostPid: number | null = null;

  // The lib omits the publishDiagnostics capability and servers like
  // typescript-language-server push no diagnostics without it. processId
  // enables the server-side parent watchdog.
  protected override getInitializeParams() {
    const params = super.getInitializeParams();
    params.processId = TeraxLspClient.hostPid;
    params.capabilities.textDocument = {
      ...params.capabilities.textDocument,
      publishDiagnostics: { relatedInformation: true },
    };
    return params;
  }

  textDocumentDidClose(uri: string): void {
    void this.raw.notify("textDocument/didClose", { textDocument: { uri } });
  }

  textDocumentDidSave(uri: string): void {
    void this.raw.notify("textDocument/didSave", { textDocument: { uri } });
  }

  async shutdownGracefully(timeoutMs = 2000): Promise<void> {
    try {
      await this.raw.request("shutdown", null, timeoutMs);
      await this.raw.notify("exit", null);
    } catch {
      // Server already dead or unresponsive; the transport kill follows.
    }
  }

  private get raw(): RawRpc {
    return this as unknown as RawRpc;
  }
}
