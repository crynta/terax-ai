import { describe, expect, it } from "vitest";
import { PromptStartScanner } from "./promptStartScanner";

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe("PromptStartScanner", () => {
  it("reports where each prompt start ends, BEL or ST terminated", () => {
    const text = "out\r\n\x1b]133;A\x07new> \x1b]133;A;cl=m\x1b\\tail";
    const cuts = new PromptStartScanner().cuts(bytes(text));
    expect(cuts).toEqual([text.indexOf("new>"), text.indexOf("tail")]);
  });

  it("ignores every other sequence", () => {
    const scanner = new PromptStartScanner();
    expect(
      scanner.cuts(
        bytes(
          "\x1b[31mred\x1b[0m\x1b]133;B\x07\x1b]133;C;ls\x07\x1b]133;D;0\x07\x1b]7;file:///a\x07\x1b]133;\x07",
        ),
      ),
    ).toEqual([]);
  });

  it("follows a sequence split at any byte", () => {
    const text = "x\x1b]133;A\x1b\\y\x1b]133;A\x07z";
    const whole = new PromptStartScanner().cuts(bytes(text));
    expect(whole).toEqual([text.indexOf("y"), text.indexOf("z")]);
    for (let split = 1; split < text.length; split++) {
      const scanner = new PromptStartScanner();
      const cuts = [
        ...scanner.cuts(bytes(text.slice(0, split))),
        ...scanner.cuts(bytes(text.slice(split))).map((cut) => cut + split),
      ];
      expect(cuts, `split at ${split}`).toEqual(whole);
    }
  });

  it("gives up on an unterminated sequence and finds the next one", () => {
    const scanner = new PromptStartScanner();
    expect(scanner.cuts(bytes(`\x1b]133;A${"a".repeat(600)}`))).toEqual([]);
    expect(scanner.cuts(bytes("\x1b]133;A\x07"))).toEqual([8]);
    // An ESC that is not an ST abandons the sequence and may start another.
    expect(scanner.cuts(bytes("\x1b]133;A\x1b\x1b]133;A\x07"))).toEqual([16]);
  });
});
