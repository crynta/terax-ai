import { describe, expect, it } from "vitest";
import {
  inspectUpdaterFeed,
  inspectUpdaterFeedText,
  signatureKeyIdFromTauriSignature,
} from "./inspect-updater-feed.mjs";

function tauriSignatureForKey(keyId) {
  const keyBytes = Buffer.from(
    keyId
      .match(/[0-9a-f]{2}/gi)
      .reverse()
      .join(""),
    "hex",
  );
  const rawSignature = Buffer.concat([Buffer.from("ED", "ascii"), keyBytes, Buffer.alloc(64, 7)]);
  const signatureText = [
    "untrusted comment: signature from tauri secret key",
    rawSignature.toString("base64"),
    "trusted comment: timestamp:1782224207\tfile:Terax.app.tar.gz",
    Buffer.alloc(64, 3).toString("base64"),
  ].join("\n");
  return Buffer.from(signatureText, "utf8").toString("base64");
}

const oldKeySignature = tauriSignatureForKey("3BABFD8AB60E3469");
const newKeySignature = tauriSignatureForKey("52D6B9847A3B8F15");

describe("inspect-updater-feed", () => {
  it("extracts the minisign key id from a Tauri feed signature", () => {
    expect(signatureKeyIdFromTauriSignature(oldKeySignature)).toEqual({
      algorithm: "ED",
      keyId: "3BABFD8AB60E3469",
    });
  });

  it("reports every platform key id and passes when they match the expected key", () => {
    const result = inspectUpdaterFeed(
      {
        platforms: {
          "darwin-aarch64": { signature: newKeySignature, url: "https://example.invalid/darwin" },
          "windows-x86_64": { signature: newKeySignature, url: "https://example.invalid/windows" },
        },
      },
      { expectedKeyId: "52d6b9847a3b8f15" },
    );

    expect(result.ok).toBe(true);
    expect(result.uniqueKeyIds).toEqual(["52D6B9847A3B8F15"]);
    expect(result.entries.map((entry) => entry.platform)).toEqual(["darwin-aarch64", "windows-x86_64"]);
  });

  it("fails when any platform is signed by the wrong key", () => {
    const result = inspectUpdaterFeed(
      {
        platforms: {
          "darwin-aarch64": { signature: newKeySignature },
          "linux-x86_64": { signature: oldKeySignature },
        },
      },
      { expectedKeyId: "52D6B9847A3B8F15" },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(["linux-x86_64 is signed by 3BABFD8AB60E3469, expected 52D6B9847A3B8F15"]),
    );
  });

  it("returns useful errors for malformed feeds", () => {
    expect(inspectUpdaterFeedText("not json")).toMatchObject({
      ok: false,
      entries: [],
      uniqueKeyIds: [],
    });

    expect(inspectUpdaterFeed({ platforms: { linux: {} } })).toMatchObject({
      ok: false,
      errors: ["linux: signature is missing"],
    });
  });
});
