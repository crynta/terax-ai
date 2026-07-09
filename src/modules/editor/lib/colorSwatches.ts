import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|(?:rgba?|hsla?)\([^)]*\)/gi;

function isHex(color: string): boolean {
  return color.startsWith("#");
}

function toHex6(color: string): string {
  const h = color.slice(1);
  if (h.length === 3 || h.length === 4) {
    const r = h[0];
    const g = h[1];
    const b = h[2];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return `#${h.slice(0, 6)}`;
}

function applyHex(original: string, picked6: string): string {
  const h = original.slice(1);
  if (h.length === 8) return `${picked6}${h.slice(6, 8)}`;
  if (h.length === 4) return `${picked6}${h[3]}${h[3]}`;
  return picked6;
}

class SwatchWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly from: number,
    readonly to: number,
    readonly editable: boolean,
  ) {
    super();
  }

  eq(other: SwatchWidget): boolean {
    return (
      other.color === this.color &&
      other.from === this.from &&
      other.to === this.to &&
      other.editable === this.editable
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-color-swatch";
    wrap.style.backgroundColor = this.color;
    if (!this.editable) return wrap;

    const input = document.createElement("input");
    input.type = "color";
    input.className = "cm-color-swatch-input";
    input.value = toHex6(this.color);
    input.addEventListener("input", () => {
      wrap.style.backgroundColor = applyHex(this.color, input.value);
    });
    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: applyHex(this.color, input.value),
        },
      });
    });
    wrap.appendChild(input);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    COLOR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COLOR_RE.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      builder.add(
        start,
        start,
        Decoration.widget({
          widget: new SwatchWidget(m[0], start, end, isHex(m[0])),
          side: -1,
        }),
      );
    }
  }
  return builder.finish();
}

export function colorSwatches(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
