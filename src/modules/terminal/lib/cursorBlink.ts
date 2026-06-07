export function shouldCursorBlink(
  blinkEnabled: boolean,
  windowActive: boolean,
  slotFocused: boolean,
): boolean {
  return blinkEnabled && windowActive && slotFocused;
}
