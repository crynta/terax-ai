import { openTerminalUrl } from "@/lib/external-link";

export function createTerminalLinkHandler(focus: () => void) {
  return {
    activate: (_event: MouseEvent, uri: string) =>
      void openTerminalUrl(uri, focus),
    // xterm drops non-http OSC 8 URIs unless this is set; activate still
    // filters schemes via openTerminalUrl (file/http/mailto/tel only).
    allowNonHttpProtocols: true,
  };
}