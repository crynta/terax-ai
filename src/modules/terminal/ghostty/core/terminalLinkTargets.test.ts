import { describe, expect, it } from "vitest";
import {
  hostShownByText,
  isLocalFileHost,
  linkTextMismatch,
  MAX_LINK_URI_LENGTH,
  pathCandidates,
  planLinkActivation,
  resolveLinkPath,
} from "./terminalLinkTargets";
import type { TerminalLinkHit } from "./terminalLinks";

const hit = (
  uri: string,
  kind: TerminalLinkHit["kind"] = "url",
  text = uri,
): TerminalLinkHit => ({ kind, uri, text, segments: [] });

describe("planLinkActivation", () => {
  it("opens http, https and mailto directly", () => {
    expect(planLinkActivation(hit("https://example.com/a?b=c"))).toEqual({
      type: "open-url",
      url: "https://example.com/a?b=c",
    });
    expect(planLinkActivation(hit("mailto:me@example.com"))).toMatchObject({
      type: "open-url",
    });
  });

  it("blocks executable and unknown schemes", () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "ssh://host",
      "vscode://file/x",
      "x-apple.systempreferences:",
    ]) {
      expect(planLinkActivation(hit(uri, "osc8")).type, uri).toBe("block");
    }
  });

  it("confirms phone links and urls with credentials or punycode hosts", () => {
    expect(planLinkActivation(hit("tel:+15551234"))).toMatchObject({
      type: "confirm-url",
      reason: "scheme",
    });
    expect(planLinkActivation(hit("https://a:b@example.com/"))).toMatchObject({
      type: "confirm-url",
      reason: "userinfo",
    });
    expect(planLinkActivation(hit("https://xn--pple-43d.com/"))).toMatchObject({
      type: "confirm-url",
      reason: "punycode",
    });
  });

  it("confirms an OSC 8 link whose visible text names another site", () => {
    expect(
      planLinkActivation(hit("https://evil.test/", "osc8", "paypal.com")),
    ).toMatchObject({ type: "confirm-url", reason: "mismatch" });
    expect(
      planLinkActivation(hit("https://evil.test/", "osc8", "click here")),
    ).toMatchObject({ type: "open-url" });
    expect(
      planLinkActivation(
        hit("https://docs.example.com/a", "osc8", "www.example.com/a"),
      ),
    ).toMatchObject({ type: "open-url" });
  });

  it("rejects control characters and oversized addresses", () => {
    expect(
      planLinkActivation(hit("https://example.com/\u001b[31m")),
    ).toMatchObject({ type: "block", reason: "invalid" });
    expect(
      planLinkActivation(
        hit(`https://example.com/${"a".repeat(MAX_LINK_URI_LENGTH)}`),
      ),
    ).toMatchObject({ type: "block", reason: "length" });
  });

  it("resolves file URLs to local paths and drops the drive slash", () => {
    expect(planLinkActivation(hit("file:///tmp/a%20b.txt"))).toEqual({
      type: "file-uri",
      host: "",
      path: "/tmp/a b.txt",
    });
    expect(planLinkActivation(hit("file:///C:/Users/me/a.txt"))).toMatchObject({
      path: "C:/Users/me/a.txt",
    });
    expect(planLinkActivation(hit("file:///"))).toMatchObject({
      type: "block",
    });
  });

  it("hands paths to the file system resolver", () => {
    expect(
      planLinkActivation({
        ...hit("src/a.ts:3", "path"),
        path: "src/a.ts",
        line: 3,
      }),
    ).toEqual({ type: "path", path: "src/a.ts", line: 3, column: undefined });
  });
});

describe("link text and hosts", () => {
  it("only reads host-like text as a claim", () => {
    expect(hostShownByText("click here")).toBeNull();
    expect(hostShownByText("main.rs")).toBeNull();
    expect(hostShownByText("example.com/path")).toBe("example.com");
    expect(linkTextMismatch("https://github.com/x", "gitlab.com")).toBe(true);
    expect(linkTextMismatch("github.com", "www.github.com")).toBe(false);
  });

  it("treats only this machine as a local file host", () => {
    expect(isLocalFileHost("", null)).toBe(true);
    expect(isLocalFileHost("LocalHost", null)).toBe(true);
    expect(isLocalFileHost("box.local", "box")).toBe(true);
    expect(isLocalFileHost("other", "box")).toBe(false);
    expect(isLocalFileHost("other", null)).toBe(false);
  });
});

describe("path resolution", () => {
  it("anchors relative paths at the pane cwd and normalizes dots", () => {
    expect(
      resolveLinkPath("./src/../lib/a.ts", { cwd: "/work/app", home: null }),
    ).toBe("/work/app/lib/a.ts");
    expect(resolveLinkPath("a.ts", { cwd: null, home: null })).toBeNull();
    expect(resolveLinkPath("/etc/hosts", { cwd: null, home: null })).toBe(
      "/etc/hosts",
    );
  });

  it("expands home and keeps Windows drives in canonical form", () => {
    expect(resolveLinkPath("~/x.md", { cwd: null, home: "/Users/me/" })).toBe(
      "/Users/me/x.md",
    );
    expect(resolveLinkPath("~/x.md", { cwd: null, home: null })).toBeNull();
    expect(
      resolveLinkPath("src\\a.ts", { cwd: "C:/work/app", home: null }),
    ).toBe("C:/work/app/src/a.ts");
    expect(
      resolveLinkPath("C:\\Users\\me\\a.txt", { cwd: null, home: null }),
    ).toBe("C:/Users/me/a.txt");
  });

  it("also tries git diff paths without their a/ or b/ prefix", () => {
    expect(pathCandidates("a/src/x.ts")).toEqual(["a/src/x.ts", "src/x.ts"]);
    expect(pathCandidates("src/x.ts")).toEqual(["src/x.ts"]);
  });
});
