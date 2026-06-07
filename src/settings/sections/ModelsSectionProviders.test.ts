import { describe, expect, it } from "vitest";
import {
  maskedProviderKey,
  parseProviderContextLimitDraft,
  providerPingStatus,
} from "./ModelsSectionProviders";

describe("ModelsSectionProviders helpers", () => {
  it("parses provider context limits with the existing lower bound", () => {
    expect(parseProviderContextLimitDraft("128000", 8192)).toEqual({
      ok: true,
      value: 128000,
    });
    expect(parseProviderContextLimitDraft("999", 8192)).toEqual({
      ok: false,
      resetValue: "8192",
    });
    expect(parseProviderContextLimitDraft("nope", undefined)).toEqual({
      ok: false,
      resetValue: "",
    });
  });

  it("uses one key mask format for local and custom endpoint cards", () => {
    expect(maskedProviderKey("sk-1234567890")).toBe("sk-1••••••••7890");
    expect(maskedProviderKey("tiny")).toBe("tiny••••••••tiny");
  });

  it("maps ping responses to shared endpoint test statuses", () => {
    expect(providerPingStatus(204)).toBe("ok");
    expect(providerPingStatus(0)).toBe("fail");
    expect(providerPingStatus(-1)).toBe("fail");
  });
});
