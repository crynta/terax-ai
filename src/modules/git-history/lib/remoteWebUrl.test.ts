import { describe, expect, it } from "vitest";
import { commitWebUrl, hostLabel, parseRemoteWebUrl } from "./remoteWebUrl";

describe("parseRemoteWebUrl", () => {
  it("parses an scp-style GitHub remote", () => {
    expect(parseRemoteWebUrl("git@github.com:owner/repo.git")).toEqual({
      host: "github",
      hostname: "github.com",
      owner: "owner",
      repo: "repo",
      baseUrl: "https://github.com/owner/repo",
    });
  });

  it("parses an https GitHub remote", () => {
    expect(parseRemoteWebUrl("https://github.com/owner/repo.git")).toEqual({
      host: "github",
      hostname: "github.com",
      owner: "owner",
      repo: "repo",
      baseUrl: "https://github.com/owner/repo",
    });
  });

  it("recognizes GitLab and Bitbucket hosts", () => {
    expect(parseRemoteWebUrl("git@gitlab.com:group/proj.git")?.host).toBe(
      "gitlab",
    );
    expect(parseRemoteWebUrl("https://bitbucket.org/team/app.git")?.host).toBe(
      "bitbucket",
    );
  });

  it("strips an optional .git suffix and leading slash", () => {
    expect(parseRemoteWebUrl("https://github.com/owner/repo")?.repo).toBe(
      "repo",
    );
    expect(parseRemoteWebUrl("git@github.com:owner/repo")?.repo).toBe("repo");
  });

  it("trims surrounding whitespace", () => {
    expect(parseRemoteWebUrl("  git@github.com:owner/repo.git  ")?.owner).toBe(
      "owner",
    );
  });

  it("lowercases the hostname but preserves owner/repo case", () => {
    const info = parseRemoteWebUrl("git@GitHub.com:Owner/Repo.git");
    expect(info?.hostname).toBe("github.com");
    expect(info?.owner).toBe("Owner");
    expect(info?.repo).toBe("Repo");
  });

  it("accepts a www. host prefix", () => {
    expect(parseRemoteWebUrl("https://www.github.com/o/r.git")?.host).toBe(
      "github",
    );
  });

  it("returns null for unsupported hosts", () => {
    expect(parseRemoteWebUrl("https://example.com/o/r.git")).toBeNull();
  });

  it("returns null when the path lacks an owner and repo", () => {
    expect(parseRemoteWebUrl("https://github.com/onlyowner")).toBeNull();
  });

  it("returns null for empty or nullish input", () => {
    expect(parseRemoteWebUrl("")).toBeNull();
    expect(parseRemoteWebUrl("   ")).toBeNull();
    expect(parseRemoteWebUrl(null)).toBeNull();
    expect(parseRemoteWebUrl(undefined)).toBeNull();
  });
});

describe("commitWebUrl", () => {
  it("builds host-specific commit paths", () => {
    const github = parseRemoteWebUrl("git@github.com:owner/repo.git");
    const gitlab = parseRemoteWebUrl("git@gitlab.com:group/proj.git");
    const bitbucket = parseRemoteWebUrl("https://bitbucket.org/team/app.git");
    if (!github || !gitlab || !bitbucket) throw new Error("expected parses");

    expect(commitWebUrl(github, "abc123")).toBe(
      "https://github.com/owner/repo/commit/abc123",
    );
    expect(commitWebUrl(gitlab, "abc123")).toBe(
      "https://gitlab.com/group/proj/-/commit/abc123",
    );
    expect(commitWebUrl(bitbucket, "abc123")).toBe(
      "https://bitbucket.org/team/app/commits/abc123",
    );
  });
});

describe("hostLabel", () => {
  it("names each supported host", () => {
    const github = parseRemoteWebUrl("git@github.com:owner/repo.git");
    const gitlab = parseRemoteWebUrl("git@gitlab.com:group/proj.git");
    const bitbucket = parseRemoteWebUrl("https://bitbucket.org/team/app.git");
    if (!github || !gitlab || !bitbucket) throw new Error("expected parses");

    expect(hostLabel(github)).toBe("View on GitHub");
    expect(hostLabel(gitlab)).toBe("View on GitLab");
    expect(hostLabel(bitbucket)).toBe("View on Bitbucket");
  });
});
