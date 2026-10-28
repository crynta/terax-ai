import {
  readBgFastPath,
  usePreferencesStore,
} from "@/modules/settings/preferences";
import { BG_OPACITY_RENDER_FACTOR } from "@/modules/settings/store";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  renderStillFrame,
  surfaceFrame,
  surfaceOwnsLayer,
} from "./surfaceFrame";
import { useWindowInactive } from "./WindowActivityBridge";

const OVERLAY_Z = 2147483646;
const RESIZE_IDLE_MS = 280;
const FADE_IN_MS = 200;

export function SurfaceLayer() {
  const [fastPath] = useState(readBgFastPath);
  const storeActive = usePreferencesStore(
    (s) => s.backgroundKind === "image" && !!s.backgroundImageId,
  );
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const active = hydrated ? storeActive : fastPath.active;
  if (!active) return null;
  return <BackgroundImage fastImageId={fastPath.imageId} />;
}

function BackgroundImage({ fastImageId }: { fastImageId: string | null }) {
  const storeImageId = usePreferencesStore((s) => s.backgroundImageId);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const imageId = hydrated ? storeImageId : fastImageId;
  const opacity = usePreferencesStore((s) => s.backgroundOpacity);
  const blur = usePreferencesStore((s) => s.backgroundBlur);
  const [state, setState] = useState<{ url: string; animated: boolean } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const lastUrlRef = useRef<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const resizing = useWindowResizing(RESIZE_IDLE_MS);
  const docHidden = useDocumentHidden();
  const inactive = useWindowInactive();
  const still = useStillFrame(
    state?.animated && inactive ? state.url : null,
    blobRef,
  );

  useEffect(() => {
    if (!imageId) return;
    let alive = true;
    let rafId: number | null = null;
    setVisible(false);
    void (async () => {
      const { getBgImage } = await import("./bgImageStore");
      const blob = await getBgImage(imageId).catch(() => null);
      if (!alive || !blob) return;
      const url = URL.createObjectURL(blob);
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = url;
      blobRef.current = blob;
      const t = blob.type.toLowerCase();
      const animated =
        t === "image/gif" || t === "image/apng" || t === "image/webp";
      setState({ url, animated });
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (alive) setVisible(true);
      });
    })();
    return () => {
      alive = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [imageId]);

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) {
        URL.revokeObjectURL(lastUrlRef.current);
        lastUrlRef.current = null;
      }
    };
  }, []);

  if (!state || typeof document === "undefined") return null;
  const { url, animated } = state;

  const frame = surfaceFrame({
    animated,
    resizing,
    documentHidden: docHidden,
    inactive,
    hasStill: still !== null,
  });
  const blurActive = !animated && blur > 0 && !resizing;
  const renderedOpacity =
    visible && frame !== "hidden" ? opacity * BG_OPACITY_RENDER_FACTOR : 0;

  return createPortal(
    <div
      aria-hidden
      className="terax-bg-surface"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: OVERLAY_Z,
        pointerEvents: "none",
        backgroundImage:
          frame === "hidden"
            ? "none"
            : `url(${frame === "still" && still ? still : url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        opacity: renderedOpacity,
        filter: blurActive ? `blur(${blur}px)` : undefined,
        // Own layer only when the blur or the animation needs one (see
        // `surfaceOwnsLayer`); a static image paints into the page.
        transform: surfaceOwnsLayer({ animated, blurActive, frame })
          ? "translateZ(0)"
          : undefined,
        transition: `opacity ${FADE_IN_MS}ms ease-out`,
      }}
    />,
    document.body,
  );
}

/**
 * A frozen first frame of the animated background, rendered once the window
 * goes inactive (`sourceUrl` becomes non-null) and cached for that image.
 * Resolves to null until ready, or when the platform cannot decode a frame.
 */
function useStillFrame(
  sourceUrl: string | null,
  blobRef: React.RefObject<Blob | null>,
): string | null {
  const [still, setStill] = useState<{ source: string; url: string } | null>(
    null,
  );
  const stillRef = useRef(still);
  stillRef.current = still;

  useEffect(() => {
    if (!sourceUrl || stillRef.current?.source === sourceUrl) return;
    const blob = blobRef.current;
    if (!blob) return;
    let alive = true;
    void renderStillFrame(blob).then((frame) => {
      if (!alive || !frame) return;
      setStill({ source: sourceUrl, url: URL.createObjectURL(frame) });
    });
    return () => {
      alive = false;
    };
  }, [sourceUrl, blobRef]);

  // Drop a still that belongs to a replaced image, and on unmount.
  useEffect(() => {
    const url = still?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [still]);

  return still && still.source === sourceUrl ? still.url : null;
}

function useWindowResizing(idleMs: number): boolean {
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    let timer: number | null = null;
    let active = false;
    const onResize = () => {
      if (!active) {
        active = true;
        setResizing(true);
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        active = false;
        setResizing(false);
        timer = null;
      }, idleMs);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [idleMs]);
  return resizing;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}
