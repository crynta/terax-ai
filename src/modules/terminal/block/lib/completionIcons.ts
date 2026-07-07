import {
  CommandLineIcon,
  File01Icon,
  Folder01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";

export type IconData = readonly (readonly [string, Record<string, unknown>])[];

const NS = "http://www.w3.org/2000/svg";

export function hugeIcon(icon: IconData, size = 13): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attrs] of icon) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    svg.appendChild(el);
  }
  return svg;
}

const ICON_BY_TYPE: Record<string, IconData> = {
  function: TerminalIcon,
  keyword: CommandLineIcon,
  type: Folder01Icon,
  variable: File01Icon,
};

export function completionIcon(type: string | undefined): HTMLElement | null {
  const data = type ? ICON_BY_TYPE[type] : undefined;
  if (!data) return null;
  const span = document.createElement("span");
  span.className = "cm-opt-icon";
  span.appendChild(hugeIcon(data));
  return span;
}
