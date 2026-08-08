import type {
  ITerminalAddon,
  IUnicodeVersionProvider,
  Terminal,
} from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { activateUnicode11 } from "./unicodeWidth";

// Drive real activation through a DOM-free fake terminal that dispatches width by
// the active version, so the width assertions fail too if the wiring regresses.
function activate() {
  let addonLoaded = false;
  // Start on a stub V6 like real xterm: a run that never switches to "11" widths
  // nothing wide, failing the assertions below instead of silently passing.
  const providers = new Map<string, IUnicodeVersionProvider>([
    ["6", { version: "6", wcwidth: () => 1, charProperties: () => 0 }],
  ]);
  const state = { activeVersion: "6" };
  const term = {
    loadAddon(addon: ITerminalAddon) {
      addonLoaded = true;
      addon.activate(term as unknown as Terminal);
    },
    unicode: {
      get versions() {
        return [...providers.keys()];
      },
      register(p: IUnicodeVersionProvider) {
        providers.set(p.version, p);
      },
      get activeVersion() {
        return state.activeVersion;
      },
      set activeVersion(v: string) {
        // Match real xterm: activating an unregistered version throws, which
        // locks the register-before-activate order in activateUnicode11.
        if (!providers.has(v)) throw new Error(`unknown Unicode version "${v}"`);
        state.activeVersion = v;
      },
    },
  };
  activateUnicode11(term as Pick<Terminal, "loadAddon" | "unicode">);
  const width = (cp: number) => {
    const provider = providers.get(state.activeVersion);
    if (!provider) throw new Error("no active provider");
    return provider.wcwidth(cp);
  };
  return {
    addonLoaded,
    activeVersion: state.activeVersion,
    activeProvider: providers.get(state.activeVersion),
    width,
  };
}

describe("terminal emoji width", () => {
  const { addonLoaded, activeVersion, activeProvider, width } = activate();

  it("loads the addon and activates Unicode version 11", () => {
    expect(addonLoaded).toBe(true);
    expect(activeVersion).toBe("11");
    expect(activeProvider?.version).toBe("11");
  });

  it("counts the large green circle as two cells", () => {
    expect(width(0x1f7e2)).toBe(2);
  });

  it("counts the whole colored circle/square block as two cells", () => {
    for (let cp = 0x1f7e0; cp <= 0x1f7eb; cp++) {
      expect(width(cp)).toBe(2);
    }
  });

  it("stays targeted: codepoints bracketing the block are one cell", () => {
    expect(width(0x1f7df)).toBe(1); // just below the block
    expect(width(0x1f7ec)).toBe(1); // just above the block
  });

  it("counts emoji-presentation triangles as two cells", () => {
    expect(width(0x23eb)).toBe(2); // fast up (double triangle)
    expect(width(0x23ec)).toBe(2); // fast down
    expect(width(0x1f53a)).toBe(2); // red triangle up
  });

  it("leaves text-presentation triangles one cell", () => {
    // Triangle glyphs used as menu/tree/prompt carets are text-default and must
    // stay narrow, or every TUI that draws them as one cell would shear instead.
    expect(width(0x25b2)).toBe(1); // black up-pointing triangle
    expect(width(0x25b6)).toBe(1); // black right-pointing triangle
    expect(width(0x25bc)).toBe(1); // black down-pointing triangle
  });

  it("keeps already-correct widths intact", () => {
    expect(width(0x41)).toBe(1); // "A"
    expect(width(0x1f534)).toBe(2); // red circle
    expect(width(0x1f9ca)).toBe(2); // ice cube
    expect(width(0x1fa90)).toBe(2); // ringed planet
  });
});
