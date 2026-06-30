import { describe, expect, it } from "vitest";
import {
  commitWebUrl,
  hostLabel,
  parseRemoteWebUrl,
  type RemoteWebInfo,
} from "./remoteWebUrl";

describe("parseRemoteWebUrl - empty / malformed", () => {
  it("returns null for null, undefined and empty input", () => {
    expect(parseRemoteWebUrl(null)).toBeNull();
    expect(parseRemoteWebUrl(undefined)).toBeNull();
    expect(parseRemoteWebUrl("")).toBeNull();
    expect(parseRemoteWebUrl("   ")).toBeNull();
  });

  it("returns null for unsupported hosts", () => {
    expect(parseRemoteWebUrl("https://example.com/owner/repo.git")).toBeNull();
    expect(parseRemoteWebUrl("git@example.com:owner/repo.git")).toBeNull();
  });

  it("returns null when the path lacks an owner and repo", () => {
    expect(parseRemoteWebUrl("https://github.com/onlyowner")).toBeNull();
    expect(parseRemoteWebUrl("https://github.com/")).toBeNull();
    expect(parseRemoteWebUrl("git@github.com:onlyowner.git")).toBeNull();
  });

  it("returns null for a totally unparseable string", () => {
    expect(parseRemoteWebUrl("not a url at all")).toBeNull();
  });
});

describe("parseRemoteWebUrl - HTTPS remotes", () => {
  it("parses a github https url and strips the .git suffix", () => {
    expect(parseRemoteWebUrl("https://github.com/acme/widgets.git")).toEqual({
      host: "github",
      hostname: "github.com",
      owner: "acme",
      repo: "widgets",
      baseUrl: "https://github.com/acme/widgets",
    });
  });

  it("parses without a .git suffix", () => {
    const info = parseRemoteWebUrl("https://gitlab.com/group/project");
    expect(info).toEqual({
      host: "gitlab",
      hostname: "gitlab.com",
      owner: "group",
      repo: "project",
      baseUrl: "https://gitlab.com/group/project",
    });
  });

  it("recognizes bitbucket", () => {
    const info = parseRemoteWebUrl("https://bitbucket.org/team/code.git");
    expect(info?.host).toBe("bitbucket");
    expect(info?.baseUrl).toBe("https://bitbucket.org/team/code");
  });

  it("normalizes a www. host prefix and lowercases the hostname", () => {
    const info = parseRemoteWebUrl("https://WWW.GitHub.com/Acme/Widgets");
    expect(info?.host).toBe("github");
    expect(info?.hostname).toBe("www.github.com");
    // Owner / repo casing is preserved; only the host is lowercased.
    expect(info?.owner).toBe("Acme");
    expect(info?.repo).toBe("Widgets");
    expect(info?.baseUrl).toBe("https://www.github.com/Acme/Widgets");
  });

  it("ignores extra path segments beyond owner/repo", () => {
    const info = parseRemoteWebUrl(
      "https://github.com/acme/widgets/tree/main/src",
    );
    expect(info?.owner).toBe("acme");
    expect(info?.repo).toBe("widgets");
  });
});

describe("parseRemoteWebUrl - SCP-style remotes", () => {
  it("parses git@github.com:owner/repo.git", () => {
    expect(parseRemoteWebUrl("git@github.com:acme/widgets.git")).toEqual({
      host: "github",
      hostname: "github.com",
      owner: "acme",
      repo: "widgets",
      baseUrl: "https://github.com/acme/widgets",
    });
  });

  it("parses scp form without a user prefix", () => {
    const info = parseRemoteWebUrl("gitlab.com:group/project.git");
    expect(info?.host).toBe("gitlab");
    expect(info?.owner).toBe("group");
    expect(info?.repo).toBe("project");
  });

  it("trims surrounding whitespace before parsing", () => {
    const info = parseRemoteWebUrl("  git@bitbucket.org:team/code.git  ");
    expect(info?.host).toBe("bitbucket");
    expect(info?.repo).toBe("code");
  });

  it("does not misread an absolute path as an scp remote", () => {
    expect(parseRemoteWebUrl("/local/path/to/repo")).toBeNull();
  });
});

describe("commitWebUrl", () => {
  const sha = "abc123";

  function info(host: RemoteWebInfo["host"]): RemoteWebInfo {
    return {
      host,
      hostname: "example",
      owner: "acme",
      repo: "widgets",
      baseUrl: "https://example/acme/widgets",
    };
  }

  it("builds a github commit url", () => {
    expect(commitWebUrl(info("github"), sha)).toBe(
      "https://example/acme/widgets/commit/abc123",
    );
  });

  it("builds a gitlab commit url with the -/ segment", () => {
    expect(commitWebUrl(info("gitlab"), sha)).toBe(
      "https://example/acme/widgets/-/commit/abc123",
    );
  });

  it("builds a bitbucket commit url with the plural commits path", () => {
    expect(commitWebUrl(info("bitbucket"), sha)).toBe(
      "https://example/acme/widgets/commits/abc123",
    );
  });

  it("round-trips a parsed remote into a commit url", () => {
    const parsed = parseRemoteWebUrl("git@github.com:acme/widgets.git");
    expect(parsed).not.toBeNull();
    expect(commitWebUrl(parsed as RemoteWebInfo, "deadbeef")).toBe(
      "https://github.com/acme/widgets/commit/deadbeef",
    );
  });
});

describe("hostLabel", () => {
  function info(host: RemoteWebInfo["host"]): RemoteWebInfo {
    return {
      host,
      hostname: "example",
      owner: "acme",
      repo: "widgets",
      baseUrl: "https://example/acme/widgets",
    };
  }

  it("labels each supported host", () => {
    expect(hostLabel(info("github"))).toBe("View on GitHub");
    expect(hostLabel(info("gitlab"))).toBe("View on GitLab");
    expect(hostLabel(info("bitbucket"))).toBe("View on Bitbucket");
  });
});
