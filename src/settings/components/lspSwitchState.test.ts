import { describe, expect, it } from "vitest";
import { resolveLspSwitchState } from "./lspSwitchState";

describe("resolveLspSwitchState", () => {
  it("enables an available language server directly", () => {
    expect(resolveLspSwitchState(false, "/usr/bin/gopls")).toEqual({
      checked: false,
      checking: false,
      enableAction: "enable",
    });
  });

  it("keeps a missing language server off and routes enabling to install", () => {
    expect(resolveLspSwitchState(true, null)).toEqual({
      checked: false,
      checking: false,
      enableAction: "install",
    });
  });

  it("prevents changes while detection is pending", () => {
    expect(resolveLspSwitchState(false, undefined)).toEqual({
      checked: false,
      checking: true,
      enableAction: "wait",
    });
  });
});
