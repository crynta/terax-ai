import { describe, expect, it } from "vitest";
import { coerceMacOptionAsAlt, optionActsAsMeta } from "./macOptionAsAlt";

describe("coerceMacOptionAsAlt", () => {
  it.each([
    ["off", "off"],
    ["left", "left"],
    ["right", "right"],
    ["both", "both"],
    ["LEFT", "off"],
    ["true", "off"],
    [true, "off"],
    [null, "off"],
    [undefined, "off"],
    [1, "off"],
  ])("%s -> %s", (value, expected) => {
    expect(coerceMacOptionAsAlt(value)).toBe(expected);
  });
});

describe("optionActsAsMeta", () => {
  const held = (left: boolean, right: boolean) => ({ left, right });

  it.each([
    ["off", held(true, true), false],
    ["both", held(false, false), true],
    ["both", held(true, false), true],
    ["left", held(true, false), true],
    ["left", held(false, true), false],
    ["left", held(true, true), true],
    ["right", held(false, true), true],
    ["right", held(true, false), false],
    ["right", held(false, false), false],
  ] as const)("%s with %j held -> %s", (setting, keys, expected) => {
    expect(optionActsAsMeta(setting, keys)).toBe(expected);
  });
});
