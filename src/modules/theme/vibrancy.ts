import { invoke } from "@tauri-apps/api/core";

/** Mirrors `Backdrop` in `src-tauri/src/modules/vibrancy.rs`. */
export type Backdrop = "vibrancy" | "mica" | "none";

/** Must stay in sync with the pre-paint script in index.html. */
export const PREPAINT_BG = { dark: "#141414", light: "#ffffff" } as const;

type Rgb = readonly [number, number, number];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const toByte = (value: number) => Math.round(clamp01(value) * 255);

function srgbEncode(linear: number): number {
  const v = clamp01(linear);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function oklabToRgb(l: number, a: number, b: number): Rgb {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toByte(
      srgbEncode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    ),
    toByte(
      srgbEncode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    ),
    toByte(
      srgbEncode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    ),
  ];
}

function numbers(body: string): number[] | null {
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  const values = parts.map((part) =>
    part.endsWith("%")
      ? Number.parseFloat(part) / 100
      : Number.parseFloat(part),
  );
  return values.every(Number.isFinite) ? values : null;
}

/**
 * A computed CSS colour as the webview serializes it (`rgb()`, `color(srgb)`,
 * `oklab()`, `oklch()`), reduced to opaque sRGB bytes. Translucent or unknown
 * values are rejected: the native window colour must be a solid theme colour.
 */
export function parseCssColor(value: string): Rgb | null {
  const match = /^([a-z-]+)\(([^)]*)\)$/i.exec(value.trim());
  if (!match) return null;
  const fn = match[1].toLowerCase();
  const body = match[2];
  const alpha = body.includes("/") ? numbers(body.split("/")[1]) : null;
  const channels = numbers(body.split("/")[0].replace(/^srgb\s+/i, ""));
  if (!channels) return null;
  if (fn === "rgba" && channels.length === 4 && channels[3] < 1) return null;
  if (alpha && alpha[0] < 1) return null;
  if (fn === "rgb" || fn === "rgba") {
    if (channels.length < 3) return null;
    return [
      Math.min(255, Math.max(0, Math.round(channels[0]))),
      Math.min(255, Math.max(0, Math.round(channels[1]))),
      Math.min(255, Math.max(0, Math.round(channels[2]))),
    ];
  }
  if (fn === "color" && /^srgb\s/i.test(body.trim())) {
    return channels.length >= 3
      ? [toByte(channels[0]), toByte(channels[1]), toByte(channels[2])]
      : null;
  }
  if (fn === "oklab" && channels.length >= 3) {
    return oklabToRgb(channels[0], channels[1], channels[2]);
  }
  if (fn === "oklch" && channels.length >= 3) {
    const hue = (channels[2] * Math.PI) / 180;
    return oklabToRgb(
      channels[0],
      channels[1] * Math.cos(hue),
      channels[1] * Math.sin(hue),
    );
  }
  return null;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The solid colour the chrome paints the whole window with. */
function readFrameColor(): string | null {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;width:0;height:0;pointer-events:none;background-color:var(--frame)";
  document.body.appendChild(probe);
  const rgb = parseCssColor(getComputedStyle(probe).backgroundColor);
  probe.remove();
  return rgb ? toHex(rgb) : null;
}

/** Theme variables are applied by a parent effect; let them settle first. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let kindPromise: Promise<Backdrop> | null = null;

export function getBackdropKind(): Promise<Backdrop> {
  kindPromise ??= invoke<Backdrop>("window_backdrop_kind").catch(
    () => "none" as const,
  );
  return kindPromise;
}

/** Last state handed to the native side. Repeating it would rebuild the
 * effect view for nothing. */
let applied: string | null = null;
let queue: Promise<void> = Promise.resolve();

/** Serialized: two in-flight toggles could otherwise land out of order. */
export function applyVibrancy(
  enabled: boolean,
  dark: boolean,
  themeId = "",
): Promise<void> {
  queue = queue.then(() => run(enabled, dark, themeId));
  return queue;
}

async function run(
  enabled: boolean,
  dark: boolean,
  themeId: string,
): Promise<void> {
  const kind = await getBackdropKind();
  const on = enabled && kind !== "none";
  const root = document.documentElement;

  const paintOpaque = () => {
    root.removeAttribute("data-vibrancy");
    root.style.backgroundColor = dark ? PREPAINT_BG.dark : PREPAINT_BG.light;
  };

  if (on) {
    root.setAttribute("data-vibrancy", "on");
    // The pre-paint colour parked on <html> sits in front of the backdrop.
    root.style.backgroundColor = "";
  } else {
    paintOpaque();
  }

  // With no backdrop the native window is opaque and painted with the theme's
  // window colour, so a theme change must reach the native side too.
  let background: string | undefined;
  if (!on) {
    await nextFrame();
    background = readFrameColor() ?? undefined;
  }

  // Mica tints its own backdrop and cannot read the webview theme, so it has
  // to be rebuilt on a mode flip; NSVisualEffectView adapts on its own.
  const key = on
    ? kind === "mica"
      ? `on:${dark}`
      : "on"
    : `off:${themeId}:${background ?? dark}`;
  if (key === applied) return;

  try {
    await invoke("window_set_backdrop", { enabled: on, dark, background });
    applied = key;
  } catch {
    // Never leave the webview transparent over nothing.
    paintOpaque();
    applied = null;
  }
}
