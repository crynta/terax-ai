import { info, warn } from "@tauri-apps/plugin-log";
import { openUrl } from "@tauri-apps/plugin-opener";

export function isExternalUrl(href: string): boolean {
  return /^(?:https?:|mailto:|tel:)/i.test(href);
}

/** Writes a link-open outcome to Terax.log; never throws (tests have no log plugin). */
export function logLink(message: string, failed = false): void {
  try {
    void (failed ? warn : info)(`link: ${message}`).catch(() => undefined);
  } catch {
    /* No Tauri bridge. */
  }
}

function scheme(href: string): string {
  return href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() ?? "path";
}

export function openExternalUrl(
  href: string,
  onSettled?: () => void,
): Promise<void> {
  if (!isExternalUrl(href)) {
    logLink(`open ${scheme(href)} skipped (not a web link)`);
    onSettled?.();
    return Promise.resolve();
  }

  return openUrl(href)
    .then(() => logLink(`open ${scheme(href)} ok`))
    .catch((error) => {
      logLink(`open ${scheme(href)} error: ${String(error)}`, true);
      console.error("[terax] failed to open external link:", error);
    })
    .finally(() => onSettled?.());
}
