export function bindTerminalInteraction(
  target: HTMLElement,
  interact: () => void,
): () => void {
  const pointerMove = (event: PointerEvent) => {
    if (event.buttons !== 0) interact();
  };
  const options = { capture: true, passive: true };
  target.addEventListener("wheel", interact, options);
  target.addEventListener("keydown", interact, options);
  target.addEventListener("pointerdown", interact, options);
  target.addEventListener("pointermove", pointerMove, options);
  return () => {
    target.removeEventListener("wheel", interact, true);
    target.removeEventListener("keydown", interact, true);
    target.removeEventListener("pointerdown", interact, true);
    target.removeEventListener("pointermove", pointerMove, true);
  };
}
