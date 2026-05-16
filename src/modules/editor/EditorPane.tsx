import {
  findNext,
  findPrevious,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { hoverTooltip, keymap } from "@codemirror/view";
import { usePreferencesStore } from "@/modules/settings/preferences";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EDITOR_THEME_EXT } from "./lib/themes";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Prec } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import {
  buildSharedExtensions,
  languageCompartment,
  vimCompartment,
} from "./lib/extensions";
import { initVimGlobals, vimHandlersExtension } from "./lib/vim";

initVimGlobals();
import { resolveLanguage } from "./lib/languageResolver";
import { useDocument } from "./lib/useDocument";
import { inlineCompletion } from "./lib/autocomplete/inlineExtension";
import { getKey } from "@/modules/ai/lib/keyring";
import { onKeysChanged } from "@/modules/settings/store";
import {
  getLspRootPath,
  getLspServerConfig,
  lspChange,
  lspClose,
  lspHover,
  lspOpen,
  type LspDiagnosticsResponse,
  lspReadDiagnostics,
  lspSave,
  lspStart,
  lspStop,
  type LspDiagnostic,
} from "./lib/lsp";

export type EditorPaneHandle = {
  setQuery: (q: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  /** Re-read the file from disk. Skips silently if the buffer is dirty. */
  reload: () => boolean;
};

type Props = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const EditorPane = forwardRef<EditorPaneHandle, Props>(
  function EditorPane({ path, onDirtyChange, onSaved, onClose }, ref) {
    const { doc, onChange, save, reload } = useDocument({ path, onDirtyChange });
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const editorThemeId = usePreferencesStore((s) => s.editorTheme);
    const vimMode = usePreferencesStore((s) => s.vimMode);
    const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
    const [lspStatus, setLspStatus] = useState<string | null>(null);
    const languageRef = useRef<string | null>(null);
    const apiKeyRef = useRef<string | null>(null);
    const lspHandleRef = useRef<number | null>(null);
    const lspPollRef = useRef<number | null>(null);
    const lspChangeRef = useRef<number | null>(null);
    const lspDiagnosticsHoldUntilRef = useRef(0);
    const lspDiagnosticsApplyRef = useRef<number | null>(null);
    const lspPendingDiagnosticsRef = useRef<LspDiagnosticsResponse | null>(null);
    const lspVisibleDiagnosticsCountRef = useRef(0);
    const lspTextRef = useRef<string>("");
    const lspDiagVersionRef = useRef(0);

    useEffect(() => {
      let cancelled = false;
      const refresh = async () => {
        const provider = usePreferencesStore.getState().autocompleteProvider;
        if (provider === "lmstudio") {
          apiKeyRef.current = null;
          return;
        }
        const k = await getKey(provider);
        if (!cancelled) apiKeyRef.current = k;
      };
      void refresh();
      let unlistenKeys: (() => void) | undefined;
      void onKeysChanged(() => void refresh()).then((un) => {
        unlistenKeys = un;
      });
      const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
        if (state.autocompleteProvider !== prev.autocompleteProvider) {
          void refresh();
        }
      });
      return () => {
        cancelled = true;
        unlistenKeys?.();
        unsubPrefs();
      };
    }, []);
    const themeExt = EDITOR_THEME_EXT[editorThemeId] ?? EDITOR_THEME_EXT.atomone;

    // Stabilize save + onSaved via refs so the extensions array never changes
    // identity — a new identity makes @uiw/react-codemirror reconfigure the
    // whole state, wiping the language compartment.
    const saveRef = useRef(save);
    saveRef.current = save;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const pathRef = useRef(path);
    pathRef.current = path;

    const clearDiagnostics = () => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch(setDiagnostics(view.state, []));
      lspDiagVersionRef.current = 0;
      lspVisibleDiagnosticsCountRef.current = 0;
    };

    const applyDiagnostics = (diagnostics: LspDiagnostic[]) => {
      const view = cmRef.current?.view;
      if (!view) return;
      const cmDiagnostics: Diagnostic[] = diagnostics.map((diag) => ({
        from: offsetForPosition(view.state.doc.toString(), diag.startLine, diag.startCharacter),
        to: offsetForPosition(view.state.doc.toString(), diag.endLine, diag.endCharacter),
        severity: toCodemirrorSeverity(diag.severity),
        message: diag.message,
        source: diag.source ?? diag.code,
      }));
      view.dispatch(setDiagnostics(view.state, cmDiagnostics));
      lspVisibleDiagnosticsCountRef.current = diagnostics.length;
    };

    const applyDiagnosticSnapshot = (snapshot: LspDiagnosticsResponse) => {
      if (snapshot.version === lspDiagVersionRef.current) return;
      lspDiagVersionRef.current = snapshot.version;
      applyDiagnostics(snapshot.diagnostics);
    };

    const scheduleSshDiagnosticsApply = (snapshot: LspDiagnosticsResponse) => {
      lspPendingDiagnosticsRef.current = snapshot;
      if (lspDiagnosticsApplyRef.current !== null) {
        window.clearTimeout(lspDiagnosticsApplyRef.current);
      }
      let delay = Math.max(0, lspDiagnosticsHoldUntilRef.current - Date.now());
      if (
        snapshot.diagnostics.length === 0 &&
        lspVisibleDiagnosticsCountRef.current > 0
      ) {
        delay = Math.max(delay, 1200);
      }
      lspDiagnosticsApplyRef.current = window.setTimeout(() => {
        lspDiagnosticsApplyRef.current = null;
        const pending = lspPendingDiagnosticsRef.current;
        lspPendingDiagnosticsRef.current = null;
        if (!pending) return;
        applyDiagnosticSnapshot(pending);
      }, delay);
    };

    const stopLspSession = (handle: number | null, closePath: string) => {
      if (lspChangeRef.current !== null) {
        window.clearTimeout(lspChangeRef.current);
        lspChangeRef.current = null;
      }
      if (lspDiagnosticsApplyRef.current !== null) {
        window.clearTimeout(lspDiagnosticsApplyRef.current);
        lspDiagnosticsApplyRef.current = null;
      }
      lspPendingDiagnosticsRef.current = null;
      if (lspPollRef.current !== null) {
        window.clearInterval(lspPollRef.current);
        lspPollRef.current = null;
      }
      lspHandleRef.current = null;
      if (handle !== null) {
        void lspClose(handle, closePath).catch(() => {});
        void lspStop(handle).catch(() => {});
      }
      clearDiagnostics();
    };

    const startLspSession = async (initialText: string, announce = true) => {
      const config = getLspServerConfig(pathRef.current);
      if (!config || workspaceEnv.kind === "wsl") return;

      const existingHandle = lspHandleRef.current;
      if (existingHandle !== null) {
        stopLspSession(existingHandle, pathRef.current);
      }

      const rootPath = getLspRootPath(pathRef.current);
      if (announce) {
        setLspStatus(`Starting ${config.command}...`);
      }
      clearDiagnostics();

      const handle = await lspStart(
        config.command,
        config.args,
        rootPath,
        workspaceEnv,
      );
      lspHandleRef.current = handle;
      await lspOpen(handle, pathRef.current, config.languageId, initialText);
      setLspStatus(null);
      lspPollRef.current = window.setInterval(() => {
        const activeHandle = lspHandleRef.current;
        if (activeHandle === null) return;
        void lspReadDiagnostics(activeHandle, pathRef.current)
          .then((snapshot) => {
            if (workspaceEnv.kind === "ssh") {
              scheduleSshDiagnosticsApply(snapshot);
              return;
            }
            applyDiagnosticSnapshot(snapshot);
          })
          .catch((error) => {
            setLspStatus(`LSP diagnostics failed: ${String(error)}`);
          });
      }, 500);
    };

    const restartLspSession = async (text: string) => {
      if (workspaceEnv.kind !== "ssh") {
        throw new Error("LSP session is unavailable");
      }
      await startLspSession(text, false);
    };

    const flushLspChange = async (text: string) => {
      if (lspChangeRef.current !== null) {
        window.clearTimeout(lspChangeRef.current);
        lspChangeRef.current = null;
      }
      const handle = lspHandleRef.current;
      if (handle === null) return;
      await lspChange(handle, pathRef.current, text);
    };

    const saveWithLspSync = async () => {
      const text = lspTextRef.current;
      await saveRef.current();
      try {
        await flushLspChange(text);
        const handle = lspHandleRef.current;
        if (handle !== null) {
          await lspSave(handle, pathRef.current, text);
        }
      } catch (error) {
        console.warn("lsp sync on save failed", error);
        const message = String(error);
        if (workspaceEnv.kind === "ssh" && message.includes("SSH LSP channel is closed")) {
          try {
            await restartLspSession(text);
          } catch (restartError) {
            setLspStatus(`LSP reconnect failed: ${String(restartError)}`);
          }
        } else {
          setLspStatus(`LSP sync delayed: ${message}`);
        }
      }
      onSavedRef.current?.();
    };

    const extensions = useMemo(
      () => [
        // basicSetup is added before user extensions by @uiw/react-codemirror,
        // so we must elevate vim's precedence to win the keymap.
        vimCompartment.of(
          usePreferencesStore.getState().vimMode ? Prec.highest(vim()) : [],
        ),
        vimHandlersExtension(() => ({
          save: () => {
            void (async () => {
              await saveWithLspSync();
            })();
          },
          close: () => onCloseRef.current?.(),
        })),
        ...buildSharedExtensions(),
        languageCompartment.of([]),
        hoverTooltip(
          async (view, pos) => {
            const handle = lspHandleRef.current;
            if (handle === null) return null;
            const line = view.state.doc.lineAt(pos);
            const hover = await lspHover(
              handle,
              pathRef.current,
              line.number - 1,
              pos - line.from,
            ).catch(() => null);
            if (!hover?.contents?.trim()) return null;
            return {
              pos,
              above: true,
              arrow: true,
              create() {
                const dom = document.createElement("div");
                dom.className = "cm-lsp-hover";
                dom.textContent = hover.contents;
                return { dom };
              },
            };
          },
          { hoverTime: 350 },
        ),
        inlineCompletion({
          getPrefs: () => {
            const s = usePreferencesStore.getState();
            return {
              enabled: s.autocompleteEnabled,
              provider: s.autocompleteProvider,
              modelId: s.autocompleteModelId,
              apiKey: apiKeyRef.current,
              lmstudioBaseURL: s.lmstudioBaseURL,
            };
          },
          getPath: () => pathRef.current,
          getLanguage: () => languageRef.current,
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void (async () => {
                await saveWithLspSync();
              })();
              return true;
            },
          },
        ]),
      ],
      [],
    );

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: vimCompartment.reconfigure(
          vimMode ? Prec.highest(vim()) : [],
        ),
      });
    }, [vimMode]);

    useEffect(() => {
      let cancelled = false;
      const ext = path.split(".").pop()?.toLowerCase() ?? null;
      languageRef.current = ext;
      resolveLanguage(path).then((ext) => {
        if (cancelled) return;
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(ext ?? []),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [path, doc.status]);

    useEffect(() => {
      lspTextRef.current = doc.status === "ready" ? doc.content : "";
    }, [doc]);

    useEffect(() => {
      const config = getLspServerConfig(path);
      if (doc.status !== "ready" || workspaceEnv.kind === "wsl" || !config) {
        if (workspaceEnv.kind === "wsl") {
          setLspStatus("LSP is currently enabled for Local and SSH workspaces.");
        } else if (!config && doc.status === "ready") {
          setLspStatus("No LSP server is configured for this file type.");
        } else {
          setLspStatus(null);
        }
        stopLspSession(lspHandleRef.current, path);
        return;
      }

      let cancelled = false;
      const initialText = doc.content;

      void (async () => {
        try {
          await startLspSession(initialText);
          if (cancelled) {
            const handle = lspHandleRef.current;
            if (handle !== null) {
              await lspStop(handle).catch(() => {});
            }
            return;
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.warn("lsp start failed", e);
          setLspStatus(`LSP failed to start: ${message}`);
          clearDiagnostics();
        }
      })();

      return () => {
        cancelled = true;
        stopLspSession(lspHandleRef.current, path);
      };
    }, [doc.status, path, workspaceEnv]);

    useImperativeHandle(
      ref,
      () => ({
        setQuery: (q: string) => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({ search: q, caseSensitive: false }),
            ),
          });
          if (q) findNext(view);
        },
        findNext: () => {
          const view = cmRef.current?.view;
          if (view) findNext(view);
        },
        findPrevious: () => {
          const view = cmRef.current?.view;
          if (view) findPrevious(view);
        },
        clearQuery: () => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: "" })),
          });
        },
        focus: () => {
          cmRef.current?.view?.focus();
        },
        getSelection: () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const { from, to } = view.state.selection.main;
          if (from === to) return null;
          return view.state.sliceDoc(from, to);
        },
        getPath: () => path,
        reload: () => reloadRef.current(),
      }),
      [path],
    );

    if (doc.status === "loading") {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      );
    }
    if (doc.status === "error") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
          {doc.message}
        </div>
      );
    }
    if (doc.status === "binary") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">Binary file</div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} · preview not supported
          </div>
        </div>
      );
    }
    if (doc.status === "toolarge") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">File too large</div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} exceeds the {formatBytes(doc.limit)} limit.
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        {lspStatus ? (
          <div className="border-b border-border bg-destructive/10 px-3 py-1 text-[11px] text-destructive">
            {lspStatus}
          </div>
        ) : null}
        <CodeMirror
          ref={cmRef}
          value={doc.content}
          onChange={(next) => {
            onChange(next);
            lspTextRef.current = next;
            if (workspaceEnv.kind === "ssh") {
              lspDiagnosticsHoldUntilRef.current = Date.now() + 700;
            }
            const handle = lspHandleRef.current;
            if (handle === null) return;
            if (lspChangeRef.current !== null) {
              window.clearTimeout(lspChangeRef.current);
            }
            const pendingText = next;
            lspChangeRef.current = window.setTimeout(() => {
              void flushLspChange(pendingText).catch((error) => {
                console.warn("lsp change sync failed", error);
                const message = String(error);
                if (workspaceEnv.kind === "ssh" && message.includes("SSH LSP channel is closed")) {
                  void restartLspSession(pendingText).catch((restartError) => {
                    setLspStatus(`LSP reconnect failed: ${String(restartError)}`);
                  });
                  return;
                }
                setLspStatus(`LSP sync delayed: ${message}`);
              });
            }, 250);
          }}
          theme={themeExt}
          extensions={extensions}
          height="100%"
          className="flex-1 min-h-0 overflow-hidden"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            searchKeymap: true,
          }}
        />
      </div>
    );
  },
);

function offsetForPosition(text: string, line: number, character: number): number {
  if (line <= 0) return Math.min(character, text.length);
  let currentLine = 0;
  let index = 0;
  while (currentLine < line && index < text.length) {
    const nextBreak = text.indexOf("\n", index);
    if (nextBreak === -1) {
      return text.length;
    }
    index = nextBreak + 1;
    currentLine += 1;
  }
  return Math.min(index + character, text.length);
}

function toCodemirrorSeverity(severity?: number): Diagnostic["severity"] {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  if (severity === 3) return "info";
  return "hint";
}
