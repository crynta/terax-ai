export type PlatformCapabilities = {
  nativeTts: boolean;
  localStt: boolean;
  wakeWord: boolean;
  overlay: boolean;
  tray: boolean;
  screenCapture: boolean;
};

function detectMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

export const caps: PlatformCapabilities = {
  nativeTts: detectMac(),
  localStt: detectMac(),
  wakeWord: detectMac(),
  overlay: detectMac(),
  tray: detectMac(),
  screenCapture: true,
};
