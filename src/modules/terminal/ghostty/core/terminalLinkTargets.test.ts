import { describe, expect, it } from "vitest";
import {
  isLocalFileHost,
  linkDestinationLabel,
  linkTextIsDestination,
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
  it("opens http and https directly", () => {
    expect(planLinkActivation(hit("https://example.com/a?b=c"))).toEqual({
      type: "open-url",
      url: "https://example.com/a?b=c",
    });
    expect(planLinkActivation(hit("http://example.com/"))).toMatchObject({
      type: "open-url",
    });
  });

  it("asks before handing an address to the mail app", () => {
    expect(planLinkActivation(hit("mailto:me@example.com"))).toMatchObject({
      type: "confirm-url",
      reason: "scheme",
      destination: "me@example.com",
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

  it("confirms an OSC 8 link whose visible text is not its address", () => {
    for (const text of ["paypal.com", "click here", "www.example.com/a", ""]) {
      expect(
        planLinkActivation(hit("https://evil.test/", "osc8", text)),
        text,
      ).toMatchObject({ type: "confirm-url", reason: "mismatch" });
    }
    expect(
      planLinkActivation(
        hit("https://docs.example.com/a", "osc8", "www.example.com/a"),
      ),
    ).toMatchObject({ type: "confirm-url", reason: "mismatch" });
  });

  it("opens an OSC 8 link that shows its own address", () => {
    for (const text of [
      "https://example.com/a",
      "example.com/a",
      "HTTPS://EXAMPLE.COM/a/",
    ]) {
      expect(
        planLinkActivation(hit("https://example.com/a", "osc8", text)),
        text,
      ).toMatchObject({ type: "open-url" });
    }
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

  it("never turns an escaped slash into a network or device path", () => {
    for (const uri of [
      "file:///%2Fattacker/share/a.txt",
      "file:///%5C%5Cattacker%5Cshare%5Ca.txt",
      "file:///%2F%5Cattacker/share",
      "file:///%5C%2Fattacker/share",
      "file://localhost//attacker/share/a.txt",
      "file:///%5C%5C%3F%5CUNC%5Cattacker%5Cshare",
      "file:///%5C%5C.%5Cpipe%5Cx",
      "file:///tmp/%0Ax",
    ]) {
      expect(planLinkActivation(hit(uri)), uri).toMatchObject({
        type: "block",
        reason: "invalid",
      });
    }
    // Escaped slashes inside a name stay local.
    expect(planLinkActivation(hit("file:///tmp/a%2Fb"))).toMatchObject({
      type: "file-uri",
      path: "/tmp/a/b",
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
  it("accepts link text only when it is the address", () => {
    const uri = "https://example.com/a?b=1";
    expect(linkTextIsDestination(uri, uri)).toBe(true);
    expect(linkTextIsDestination("example.com/a?b=1", uri)).toBe(true);
    expect(linkTextIsDestination("http://example.com/a?b=1", uri)).toBe(false);
    expect(linkTextIsDestination("example.com", uri)).toBe(false);
    expect(linkTextIsDestination("click here", uri)).toBe(false);
    expect(linkTextIsDestination("  ", uri)).toBe(false);
  });

  it("labels a hovered link with where it leads, bounded and printable", () => {
    expect(linkDestinationLabel(hit("https://example.com/a"))).toBe(
      "https://example.com/a",
    );
    expect(
      linkDestinationLabel({
        ...hit("src/a.ts:3:4", "path"),
        path: "src/a.ts",
        line: 3,
        column: 4,
      }),
    ).toBe("src/a.ts:3:4");
    expect(linkDestinationLabel(hit("https://x.test/\u001b[31m"))).toBe(
      "https://x.test/[31m",
    );
    expect(linkDestinationLabel(hit(`https://x.test/${"a".repeat(1000)}`))).toHaveLength(
      303,
    );
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
