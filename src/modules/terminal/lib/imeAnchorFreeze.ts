/**
 * Freeze the xterm helper textarea (and optional composition view) position
 * for the duration of an IME composition.
 *
 * xterm's CompositionHelper.updateCompositionElements() repositions the
 * textarea on every render from the buffer cursor. Streaming TUIs move that
 * cursor constantly, so the native IME candidate window jumps (#1077).
 *
 * Capture left/top on the first compositionupdate (after xterm's initial
 * place), then restore them whenever something moves the elements until
 * compositionend / blur.
 */

export type FrozenAnchor = {
  left: string;
  top: string;
};

export function readAnchor(el: HTMLElement): FrozenAnchor {
  return {
    left: el.style.left || "0px",
    top: el.style.top || "0px",
  };
}

export function applyAnchor(el: HTMLElement, frozen: FrozenAnchor): void {
  if (el.style.left !== frozen.left) el.style.left = frozen.left;
  if (el.style.top !== frozen.top) el.style.top = frozen.top;
}

export type ImeAnchorFreezeHandle = {
  dispose: () => void;
};

/**
 * Attach freeze listeners to an xterm helper textarea.
 * Returns a dispose function that removes listeners and stops observing.
 */
export function attachImeAnchorFreeze(
  textarea: HTMLTextAreaElement,
  options?: { compositionView?: HTMLElement | null },
): ImeAnchorFreezeHandle {
  let frozen: FrozenAnchor | null = null;
  let observer: MutationObserver | null = null;

  const targets = (): HTMLElement[] => {
    const list: HTMLElement[] = [textarea];
    const view = options?.compositionView;
    if (view) list.push(view);
    return list;
  };

  const stopObserving = () => {
    observer?.disconnect();
    observer = null;
  };

  const clearFreeze = () => {
    frozen = null;
    stopObserving();
  };

  const reapply = () => {
    if (!frozen) return;
    for (const el of targets()) applyAnchor(el, frozen);
  };

  const startObserving = () => {
    stopObserving();
    observer = new MutationObserver(reapply);
    for (const el of targets()) {
      observer.observe(el, { attributes: true, attributeFilter: ["style"] });
    }
  };

  const onCompositionUpdate = () => {
    if (frozen) return;
    frozen = readAnchor(textarea);
    // Also pin the composition view to the same origin if present.
    const view = options?.compositionView;
    if (view) applyAnchor(view, frozen);
    startObserving();
  };

  const onCompositionEnd = () => clearFreeze();
  const onBlur = () => clearFreeze();

  textarea.addEventListener("compositionupdate", onCompositionUpdate);
  textarea.addEventListener("compositionend", onCompositionEnd);
  textarea.addEventListener("blur", onBlur);

  return {
    dispose: () => {
      clearFreeze();
      textarea.removeEventListener("compositionupdate", onCompositionUpdate);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      textarea.removeEventListener("blur", onBlur);
    },
  };
}
