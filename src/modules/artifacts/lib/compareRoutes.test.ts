/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultArtifactCompareRoute,
  loadArtifactCompareRecentRoutes,
  normalizeCompareRoute,
  rememberArtifactCompareRoute,
} from "./compareRoutes";

describe("artifact compare route recents", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("normalizes and validates http routes", () => {
    expect(normalizeCompareRoute(" http://localhost:5173/hero ")).toBe(
      "http://localhost:5173/hero",
    );
    expect(normalizeCompareRoute("https://example.com/app")).toBe(
      "https://example.com/app",
    );
    expect(normalizeCompareRoute("file:///tmp/index.html")).toBeNull();
    expect(normalizeCompareRoute("not a url")).toBeNull();
  });

  it("remembers recent routes with newest first and a bounded list", () => {
    for (let index = 0; index < 7; index += 1) {
      rememberArtifactCompareRoute(`http://localhost:5173/page-${index}`);
    }
    rememberArtifactCompareRoute("http://localhost:5173/page-4");

    expect(loadArtifactCompareRecentRoutes()).toEqual([
      "http://localhost:5173/page-4",
      "http://localhost:5173/page-6",
      "http://localhost:5173/page-5",
      "http://localhost:5173/page-3",
      "http://localhost:5173/page-2",
    ]);
    expect(defaultArtifactCompareRoute()).toBe("http://localhost:5173/page-4");
  });
});
