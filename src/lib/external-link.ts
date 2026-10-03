import { openUrl } from "@tauri-apps/plugin-opener";

export function isExternalUrl(href: string): boolean {
  return /^(?:https?:|mailto:|tel:)/i.test(href);
}

/** Schemes the terminal OSC 8 / web-links path may open via the native opener.
 * Includes `file:` so eza/ls --hyperlink works; still rejects javascript:/data:. */
export function isTerminalOpenableUrl(href: string): boolean {
  return isExternalUrl(href) || /^file:/i.test(href);
}

function openViaOpener(href: string, onSettled?: () => void): Promise<void> {
  return openUrl(href)
    .catch((error) => {
      console.error("[terax] failed to open external link:", error);
    })
    .finally(() => onSettled?.());
}

export function openExternalUrl(
  href: string,
  onSettled?: () => void,
): Promise<void> {
  if (!isExternalUrl(href)) {
    onSettled?.();
    return Promise.resolve();
  }
  return openViaOpener(href, onSettled);
}

/** Terminal link activation (OSC 8 + WebLinksAddon). Allows `file:` in addition
 * to the web/mail/tel schemes used elsewhere. */
export function openTerminalUrl(
  href: string,
  onSettled?: () => void,
): Promise<void> {
  if (!isTerminalOpenableUrl(href)) {
    onSettled?.();
    return Promise.resolve();
  }
  return openViaOpener(href, onSettled);
}