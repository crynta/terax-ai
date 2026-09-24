/**
 * Middle-click (button === 1) closes a tab when more than one is open.
 *
 * Close must run on `mousedown`, not `auxclick`: calling preventDefault() on
 * the middle-button mousedown (to suppress the browser autoscroll cursor)
 * cancels the subsequent auxclick per the DOM UI Events spec. That is why the
 * #484 auxclick handler never fired in practice (#609, #400).
 */
export function shouldCloseTabOnMiddleMouse(
  button: number,
  tabCount: number,
): boolean {
  return button === 1 && tabCount > 1;
}
