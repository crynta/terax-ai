import { StateEffect, StateField } from "@codemirror/state";
import { type EditorView, type Panel, showPanel } from "@codemirror/view";

export type LocationItem = {
  uri: string;
  /** 0-based */
  line: number;
  character: number;
  label: string;
};

type PanelSpec = {
  title: string;
  items: LocationItem[];
  onPick: (item: LocationItem) => void;
};

export const setLocationList = StateEffect.define<PanelSpec | null>();

const locationsField = StateField.define<PanelSpec | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setLocationList)) return e.value;
    }
    return value;
  },
  provide: (f) =>
    showPanel.from(f, (spec) =>
      spec ? (view) => createPanel(view, spec) : null,
    ),
});

export function openLocationsPanel(view: EditorView, spec: PanelSpec): void {
  view.dispatch({ effects: setLocationList.of(spec) });
}

function closePanel(view: EditorView): void {
  view.dispatch({ effects: setLocationList.of(null) });
  view.focus();
}

function createPanel(view: EditorView, spec: PanelSpec): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-lsp-locations";

  const header = document.createElement("div");
  header.className = "cm-lsp-locations-header";
  header.textContent = `${spec.title} (${spec.items.length})`;
  dom.appendChild(header);

  const list = document.createElement("ul");
  list.tabIndex = 0;
  dom.appendChild(list);

  let active = 0;
  const rows: HTMLElement[] = spec.items.map((item, i) => {
    const li = document.createElement("li");
    li.textContent = item.label;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pick(i);
    });
    list.appendChild(li);
    return li;
  });

  const renderActive = () => {
    rows.forEach((row, i) => {
      row.classList.toggle("cm-lsp-locations-active", i === active);
    });
    rows[active]?.scrollIntoView({ block: "nearest" });
  };

  const pick = (i: number) => {
    const item = spec.items[i];
    closePanel(view);
    spec.onPick(item);
  };

  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      active = Math.min(active + 1, spec.items.length - 1);
      renderActive();
    } else if (e.key === "ArrowUp") {
      active = Math.max(active - 1, 0);
      renderActive();
    } else if (e.key === "Enter") {
      pick(active);
    } else if (e.key === "Escape") {
      closePanel(view);
    } else {
      return;
    }
    e.preventDefault();
  });

  renderActive();
  return {
    dom,
    mount: () => list.focus(),
  };
}

export const locationsPanel = locationsField;
