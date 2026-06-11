import {
  type EditorState,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  showTooltip,
  type Tooltip,
  type TooltipView,
} from "@codemirror/view";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { hugeIcon } from "./completionIcons";

type Fetcher = (query: string, limit: number) => Promise<string[]>;

type HState = { open: boolean; items: string[]; index: number };

const CLOSED: HState = { open: false, items: [], index: 0 };
const LIMIT = 200;
const REFILTER_MS = 60;

const setHistory = StateEffect.define<HState>();

const historyField = StateField.define<HState>({
  create: () => CLOSED,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHistory)) return e.value;
    return value;
  },
  provide: (f) => showTooltip.from(f, (s) => (s.open ? TOOLTIP : null)),
});

export function historyOpen(state: EditorState): boolean {
  return state.field(historyField, false)?.open ?? false;
}

function dispatch(view: EditorView, next: HState) {
  view.dispatch({ effects: setHistory.of(next) });
}

function close(view: EditorView) {
  if (view.state.field(historyField, false)?.open) dispatch(view, CLOSED);
}

function acceptIndex(view: EditorView, i: number) {
  const h = view.state.field(historyField, false);
  const cmd = h?.items[i];
  if (cmd == null) {
    close(view);
    return;
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: cmd },
    selection: { anchor: cmd.length },
    effects: setHistory.of(CLOSED),
  });
  view.focus();
}

const TOOLTIP: Tooltip = {
  pos: 0,
  above: true,
  strictSide: true,
  arrow: false,
  create: historyTooltipView,
};

function historyTooltipView(view: EditorView): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-history-popover";
  const list = document.createElement("div");
  list.className = "cm-history-list";
  const footer = document.createElement("div");
  footer.className = "cm-history-footer";
  footer.textContent = "↑↓ navigate · ↵ run · esc";
  dom.append(list, footer);

  let lastSig = "";
  const render = () => {
    const h = view.state.field(historyField);
    const sig = `${h.index}|${h.items.length}|${h.items[0] ?? ""}`;
    if (sig === lastSig) return;
    lastSig = sig;
    list.replaceChildren();
    h.items.forEach((cmd, i) => {
      const row = document.createElement("div");
      row.className = "cm-history-item";
      if (i === h.index) row.setAttribute("aria-selected", "true");
      const icon = hugeIcon(Clock01Icon, 12);
      icon.classList.add("cm-history-icon");
      const text = document.createElement("span");
      text.className = "cm-history-text";
      text.textContent = cmd;
      row.append(icon, text);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        acceptIndex(view, i);
      });
      row.addEventListener("mouseenter", () => {
        const cur = view.state.field(historyField, false);
        if (cur?.open && cur.index !== i) {
          dispatch(view, { ...cur, index: i });
        }
      });
      list.appendChild(row);
    });
    const active = list.children[h.index] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  };

  render();
  return {
    dom,
    mount: render,
    update(u) {
      if (u.state.field(historyField) !== u.startState.field(historyField)) {
        render();
      }
    },
  };
}

export function historyPopover(fetch: Fetcher) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = (view: EditorView) => {
    const query = view.state.doc.toString();
    void fetch(query, LIMIT).then((items) => {
      if (items.length) dispatch(view, { open: true, items, index: 0 });
    });
  };

  const refilter = (view: EditorView) => {
    if (timer) clearTimeout(timer);
    const query = view.state.doc.toString();
    timer = setTimeout(() => {
      void fetch(query, LIMIT).then((items) => {
        if (view.state.field(historyField, false)?.open) {
          dispatch(view, { open: true, items, index: 0 });
        }
      });
    }, REFILTER_MS);
  };

  const upOrOpen = (view: EditorView): boolean => {
    const h = view.state.field(historyField, false);
    if (h?.open) {
      if (h.index > 0) dispatch(view, { ...h, index: h.index - 1 });
      return true;
    }
    const head = view.state.selection.main.head;
    if (view.state.doc.lineAt(head).number !== 1) return false;
    open(view);
    return true;
  };

  const downOrClose = (view: EditorView): boolean => {
    const h = view.state.field(historyField, false);
    if (!h?.open) return false;
    if (h.index >= h.items.length - 1) close(view);
    else dispatch(view, { ...h, index: h.index + 1 });
    return true;
  };

  const accept = (view: EditorView): boolean => {
    const h = view.state.field(historyField, false);
    if (!h?.open) return false;
    acceptIndex(view, h.index);
    return true;
  };

  const dismiss = (view: EditorView): boolean => {
    if (!view.state.field(historyField, false)?.open) return false;
    close(view);
    return true;
  };

  return [
    historyField,
    Prec.highest(
      keymap.of([
        { key: "ArrowUp", run: upOrOpen },
        { key: "ArrowDown", run: downOrClose },
        { key: "Enter", run: accept },
        { key: "Escape", run: dismiss },
      ]),
    ),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      if (u.state.field(historyField, false)?.open) refilter(u.view);
    }),
  ];
}
