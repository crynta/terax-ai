function isHtmlImageTarget(target: EventTarget | null): boolean {
  return (
    !!target &&
    "tagName" in target &&
    (target as { tagName: string }).tagName === "IMG"
  );
}

export function suppressNativeImageContextMenu(event: Event): void {
  if (isHtmlImageTarget(event.target)) event.preventDefault();
}

export function bindNativeImageContextMenu(): () => void {
  document.addEventListener(
    "contextmenu",
    suppressNativeImageContextMenu,
    true,
  );
  return () => {
    document.removeEventListener(
      "contextmenu",
      suppressNativeImageContextMenu,
      true,
    );
  };
}

export function shouldOfferAskFromPointer(
  event: Pick<MouseEvent, "button" | "ctrlKey">,
  isMac: boolean,
): boolean {
  if (event.button !== 0) return false;
  if (isMac && event.ctrlKey) return false;
  return true;
}
