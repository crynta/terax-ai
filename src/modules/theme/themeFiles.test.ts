import { describe, expect, it } from "vitest";
import { starterTheme } from "./themeFiles";

describe("starterTheme", () => {
  it("exposes terminal font settings in newly created themes", () => {
    expect(starterTheme().variants.dark?.terminal).toMatchObject({
      fontFamily: "JetBrains Mono",
      fontWeight: "normal",
      fontSize: 14,
    });
  });
});
