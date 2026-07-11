import { lspFormatDocument, useLspExtension } from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { redo, undo } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { convertFileSrc } from "@tauri-apps/api/core";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  createAutocompleteKeyWatcher,
  snapshotAutocompletePrefs,
} from "./lib/autocomplete/deps";
import { inlineCompletion } from "./lib/autocomplete/inlineExtension";
import { diagnosticsReporter } from "./lib/diagnosticsReporter";
import { useDiagnosticsStore } from "./lib/diagnosticsStore";
import {
  buildSharedExtensions,
  languageCompartment,
  lspCompartment,
  vimCompartment,
  wrapCompartment,
} from "./lib/extensions";
import {
  applyFormattedContent,
  readFileText,
  runExternalFormatter,
} from "./lib/externalFormat";
import { type LanguageResult, resolveLanguage } from "./lib/languageResolver";
import { useDocument } from "./lib/useDocument";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";
import {
  applyVimKeymaps,
  initVimGlobals,
  vimHandlersExtension,
} from "./lib/vim";

initVimGlobals();

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
  /** Move the cursor to a 1-based line and center it, once content is ready. */
  gotoLine: (line: number) => void;
  /** Apply CodeMirror's undo/redo commands. */
  undo: () => void;
  redo: () => void;
};

type Props = {
  path: string;
  overrideLanguage?: string | null;
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
  function EditorPane(props, ref) {
    const { path, overrideLanguage, onDirtyChange, onSaved, onClose } = props;

    const { doc, onChange, save, reload, markSaved } = useDocument({
      path,
      onDirtyChange,
    });
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const markSavedRef = useRef(markSaved);
    markSavedRef.current = markSaved;
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const themeExt = useEditorThemeExt();
    const vimMode = usePreferencesStore((s) => s.vimMode);
    const vimKeymaps = usePreferencesStore((s) => s.vimKeymaps);
    const editorWordWrap = usePreferencesStore((s) => s.editorWordWrap);

    // Global vim adapter state — re-applied whenever the pref changes.
    useEffect(() => {
      applyVimKeymaps(vimKeymaps);
    }, [vimKeymaps]);
    const languageRef = useRef<string | null>(null);
    const [langId, setLangId] = useState<string | null>(null);
    const apiKeyRef = useRef<string | null>(null);

    useEffect(() => {
      const watcher = createAutocompleteKeyWatcher((k) => {
        apiKeyRef.current = k;
      });
      return () => watcher.dispose();
    }, []);
    // Stabilize save + onSaved via refs so the extensions array never changes
    // identity — a new identity makes @uiw/react-codemirror reconfigure the
    // whole state, wiping the language compartment.
    const saveRef = useRef(save);
    saveRef.current = save;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const lspActiveRef = useRef(false);
    const warnedNoLspRef = useRef(false);

    const performSave = useCallback(async () => {
      const view = cmRef.current?.view;
      const prefs = usePreferencesStore.getState();
      const formatter = prefs.editorFormatter;
      if (prefs.editorFormatOnSave && formatter === "lsp" && view) {
        if (lspActiveRef.current) {
          await lspFormatDocument(view).catch(() => {});
        } else if (!warnedNoLspRef.current) {
          warnedNoLspRef.current = true;
          toast.warning("Format on save skipped", {
            description:
              "No active language server for this file. Enable one in the statusbar, or pick Biome/Prettier in Settings.",
          });
        }
      }
      await saveRef.current();
      if (prefs.editorFormatOnSave && formatter !== "lsp") {
        const error = await runExternalFormatter(formatter, pathRef.current);
        if (error) {
          toast.error(`${formatter} format failed`, { description: error });
        } else {
          const text = await readFileText(pathRef.current);
          if (text !== null && view) {
            markSavedRef.current(text);
            applyFormattedContent(view, text);
          }
        }
      }
      onSavedRef.current?.();
    }, []);
    const performSaveRef = useRef(performSave);
    performSaveRef.current = performSave;

    const pathRef = useRef(path);
    pathRef.current = path;

    const pendingLineRef = useRef<number | null>(null);
    const statusRef = useRef(doc.status);
    statusRef.current = doc.status;

    const applyPendingGoto = useCallback(() => {
      const view = cmRef.current?.view;
      const line = pendingLineRef.current;
      if (!view || line == null || statusRef.current !== "ready") return;
      const target = Math.max(1, Math.min(line, view.state.doc.lines));
      const at = view.state.doc.line(target).from;
      view.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "center" }),
      });
      view.focus();
      pendingLineRef.current = null;
    }, []);

    useEffect(() => {
      if (doc.status === "ready") applyPendingGoto();
    }, [doc.status, applyPendingGoto]);

    const extensions = useMemo(
      () => [
        // basicSetup is added before user extensions by @uiw/react-codemirror,
        // so we must elevate vim's precedence to win the keymap.
        vimCompartment.of(
          usePreferencesStore.getState().vimMode ? Prec.highest(vim()) : [],
        ),
        wrapCompartment.of(
          usePreferencesStore.getState().editorWordWrap
            ? EditorView.lineWrapping
            : [],
        ),
        vimHandlersExtension(() => ({
          save: () => {
            void performSaveRef.current();
          },
          close: () => onCloseRef.current?.(),
        })),
        ...buildSharedExtensions(),
        languageCompartment.of([]),
        lspCompartment.of([]),
        diagnosticsReporter(() => pathRef.current),
        inlineCompletion({
          getPrefs: () => snapshotAutocompletePrefs(apiKeyRef.current),
          getPath: () => pathRef.current,
          getLanguage: () => languageRef.current,
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void performSaveRef.current();
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
        effects: vimCompartment.reconfigure(vimMode ? Prec.highest(vim()) : []),
      });
    }, [vimMode]);

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: wrapCompartment.reconfigure(
          editorWordWrap ? EditorView.lineWrapping : [],
        ),
      });
    }, [editorWordWrap]);

    const lspExt = useLspExtension(path, langId, doc.status === "ready");
    useEffect(() => {
      lspActiveRef.current = lspExt !== null;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: lspCompartment.reconfigure(lspExt ?? []),
      });
    }, [lspExt]);

    useEffect(
      () => () => useDiagnosticsStore.getState().report(pathRef.current, null),
      [],
    );

    useEffect(() => {
      const ext =
        overrideLanguage || (path.split(".").pop()?.toLowerCase() ?? null);
      languageRef.current = ext;
      if (doc.status !== "ready") return;
      let cancelled = false;
      const resolve = async (): Promise<LanguageResult> => {
        const resolvePath = overrideLanguage
          ? `dummy.${overrideLanguage}`
          : path;
        return (
          (await resolveLanguage(resolvePath)) ?? { ext: [], name: "", id: "" }
        );
      };
      void resolve().then((result) => {
        if (cancelled) return;
        if (result.id) languageRef.current = result.id;
        setLangId(result.id || ext);
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(result.ext),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [path, doc.status, overrideLanguage]);

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
        gotoLine: (line: number) => {
          pendingLineRef.current = line;
          applyPendingGoto();
        },
        undo: () => {
          const view = cmRef.current?.view;
          if (view) undo(view);
        },
        redo: () => {
          const view = cmRef.current?.view;
          if (view) redo(view);
        },
      }),
      [path, applyPendingGoto],
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
    if (doc.status === "binary" || doc.status === "toolarge") {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const isImage = [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "svg",
        "ico",
      ].includes(ext);
      const isVideo = ["mp4", "webm", "ogg", "mov"].includes(ext);
      const isAudio = ["mp3", "wav", "flac", "aac", "m4a"].includes(ext);
      const isPdf = ext === "pdf";

      if (isImage || isVideo || isAudio || isPdf) {
        const assetUrl = convertFileSrc(path);
        return (
          <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background p-4 overflow-auto">
            {isImage && (
              <img
                src={assetUrl}
                loading="lazy"
                decoding="async"
                className="max-w-full max-h-full object-contain rounded-md border border-border shadow-sm"
                style={{
                  backgroundImage:
                    "conic-gradient(#e5e7eb 0.25turn, #f3f4f6 0.25turn 0.5turn, #e5e7eb 0.5turn 0.75turn, #f3f4f6 0.75turn)",
                  backgroundSize: "20px 20px",
                }}
                alt={path.split("/").pop()}
              />
            )}
            {isVideo && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <video
                controls
                preload="metadata"
                className="max-w-full max-h-full"
                src={assetUrl}
              />
            )}
            {isAudio && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <audio
                controls
                preload="metadata"
                className="w-full max-w-md"
                src={assetUrl}
              />
            )}
            {isPdf && (
              <iframe
                src={assetUrl}
                className="w-full h-full border-none"
                title={path.split("/").pop()}
              />
            )}
          </div>
        );
      }

      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">
            {doc.status === "binary" ? "Binary file" : "File too large"}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} · preview not supported
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col zoom-exempt">
        <CodeMirror
          ref={cmRef}
          value={doc.content}
          onChange={onChange}
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
