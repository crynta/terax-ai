import { describe, expect, it } from "vitest";
import {
  nodeBinaryRelativePath,
  nodeDistributionArchiveName,
  nodeDistributionName,
} from "./build-node-runtime.mjs";

describe("build-node-runtime", () => {
  it("stages Node at the path Rust probes in bundled resources", () => {
    expect(nodeBinaryRelativePath("darwin")).toBe("bin/node");
    expect(nodeBinaryRelativePath("linux")).toBe("bin/node");
    expect(nodeBinaryRelativePath("win32")).toBe("node.exe");
  });

  it("maps platforms and architectures to official Node distributions", () => {
    expect(
      nodeDistributionName({
        version: "22.13.1",
        platform: "darwin",
        arch: "arm64",
      }),
    ).toBe("node-v22.13.1-darwin-arm64");
    expect(
      nodeDistributionName({
        version: "22.13.1",
        platform: "linux",
        arch: "x64",
      }),
    ).toBe("node-v22.13.1-linux-x64");
    expect(
      nodeDistributionName({
        version: "22.13.1",
        platform: "win32",
        arch: "x64",
      }),
    ).toBe("node-v22.13.1-win-x64");
  });

  it("uses tarballs for Unix and zip for Windows", () => {
    expect(
      nodeDistributionArchiveName({
        version: "22.13.1",
        platform: "darwin",
        arch: "arm64",
      }),
    ).toBe("node-v22.13.1-darwin-arm64.tar.gz");
    expect(
      nodeDistributionArchiveName({
        version: "22.13.1",
        platform: "win32",
        arch: "x64",
      }),
    ).toBe("node-v22.13.1-win-x64.zip");
  });
});
