import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_RUNTIME_VERSION,
  nodeBinaryRelativePath,
  nodeDistributionArchiveName,
  nodeDistributionName,
  parseNodeShasums,
  selectedSource,
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

  it("uses pinned downloads in CI and local copies for local builds", () => {
    expect(DEFAULT_NODE_RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(selectedSource([], { CI: "true" })).toBe("download");
    expect(selectedSource([], {})).toBe("local");
    expect(selectedSource(["--local"], { CI: "true" })).toBe("local");
    expect(selectedSource(["--download"], {})).toBe("download");
  });

  it("parses the official Node SHASUMS256 manifest for archive verification", () => {
    expect(
      parseNodeShasums(
        `abc123  node-v${DEFAULT_NODE_RUNTIME_VERSION}-darwin-arm64.tar.gz\n` +
          `def456  node-v${DEFAULT_NODE_RUNTIME_VERSION}-win-x64.zip\n`,
        `node-v${DEFAULT_NODE_RUNTIME_VERSION}-win-x64.zip`,
      ),
    ).toBe("def456");
  });
});
