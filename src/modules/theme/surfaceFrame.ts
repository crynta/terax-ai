/**
 * What an animated background image should show right now.
 *
 * - `live`: the animated image, decoding and repainting.
 * - `still`: a frozen frame. Used while the window is unfocused but still
 *   on screen, so switching to another app stops the decoder without making
 *   the background vanish from a window the user can see.
 * - `hidden`: nothing, which also stops the decoder. For resizing (repaint
 *   cost) and a hidden document (nobody is looking).
 *
 * Static images are always `live`: they cost nothing to keep.
 */
export type SurfaceFrame = "live" | "still" | "hidden";

export function surfaceFrame(input: {
  animated: boolean;
  resizing: boolean;
  documentHidden: boolean;
  /** Window unfocused, hidden or occluded (see `windowActivity`). */
  inactive: boolean;
  /** A frozen frame for the current image has been rendered. */
  hasStill: boolean;
}): SurfaceFrame {
  if (!input.animated) return "live";
  if (input.resizing || input.documentHidden) return "hidden";
  // Keep animating until the still is ready, so freezing is seamless instead
  // of a fade-out followed by a fade-in.
  if (input.inactive && input.hasStill) return "still";
  return "live";
}

/**
 * Whether the background overlay needs a compositing layer of its own.
 *
 * A layer costs a window-sized backing store (several, while the window
 * resizes: WebKit allocates a new one at every step), so it is only worth it
 * when something would otherwise repaint the page tiles: the blur filter or an
 * animated image's frames. A static image without blur paints into the page
 * once and never changes. Nothing is shown while an animated image is hidden.
 */
export function surfaceOwnsLayer(input: {
  animated: boolean;
  blurActive: boolean;
  frame: SurfaceFrame;
}): boolean {
  return input.animated ? input.frame !== "hidden" : input.blurActive;
}

/**
 * Renders the first frame of an (animated) image to a PNG blob, or null when
 * the platform cannot decode it. `createImageBitmap` yields the first frame
 * of GIF / APNG / animated WebP.
 */
export async function renderStillFrame(source: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    // Release the backing store now rather than at GC time.
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } catch {
    return null;
  }
}
