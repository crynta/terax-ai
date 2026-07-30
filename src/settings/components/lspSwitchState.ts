export type LspSwitchState = {
  checked: boolean;
  checking: boolean;
  enableAction: "enable" | "install" | "wait";
};

export function resolveLspSwitchState(
  enabled: boolean,
  detected: string | null | undefined,
): LspSwitchState {
  return {
    checked: enabled && detected !== null,
    checking: detected === undefined,
    enableAction:
      detected === undefined ? "wait" : detected ? "enable" : "install",
  };
}
