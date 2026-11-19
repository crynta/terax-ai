/** Which Option key acts as Alt (Meta) on macOS; Ghostty's `macos-option-as-alt`. */
const MAC_OPTION_AS_ALT_VALUES = ["off", "left", "right", "both"] as const;

export type MacOptionAsAlt = (typeof MAC_OPTION_AS_ALT_VALUES)[number];

export const DEFAULT_MAC_OPTION_AS_ALT: MacOptionAsAlt = "off";

export function coerceMacOptionAsAlt(value: unknown): MacOptionAsAlt {
  return (
    MAC_OPTION_AS_ALT_VALUES.find((candidate) => candidate === value) ??
    DEFAULT_MAC_OPTION_AS_ALT
  );
}

/**
 * A key event does not say which Option is held, so the controller tracks the
 * two Option keys itself (bit 1 left, bit 2 right) and asks with what it saw.
 */
export function optionActsAsMeta(
  setting: MacOptionAsAlt,
  held: number,
): boolean {
  switch (setting) {
    case "both":
      return true;
    case "left":
      return (held & 1) !== 0;
    case "right":
      return (held & 2) !== 0;
    default:
      return false;
  }
}
