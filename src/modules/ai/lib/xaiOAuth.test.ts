import { describe, expect, it } from "vitest";
import {
  credentialsFromTokenResponse,
  emailFromIdToken,
  parseOAuthSession,
  sessionFromCredentialMap,
  sessionNeedsRefresh,
  sessionToCredentialEntries,
  WIN_CREDENTIAL_MAX_CHARS,
  XAI_OAUTH_ACCOUNT,
  XAI_OAUTH_REFRESH_SKEW_MS,
} from "./xaiOAuth";

function jwtFromPayload(payload: Record<string, unknown>): string {
  const encode = (value: object) => {
    const json = JSON.stringify(value);
    const b64 = btoa(json)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return b64;
  };
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.sig`;
}

const validSession = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: 1_700_000_000_000,
  idToken: "id-1",
  email: "user@example.com",
  name: "Ada",
};

describe("parseOAuthSession", () => {
  it("accepts a complete session object", () => {
    expect(parseOAuthSession(validSession)).toEqual(validSession);
  });

  it("parses a JSON string", () => {
    expect(parseOAuthSession(JSON.stringify(validSession))).toEqual(
      validSession,
    );
  });

  it("drops empty optional fields", () => {
    expect(
      parseOAuthSession({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: 10,
        idToken: "",
        email: "",
        name: "",
      }),
    ).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 10,
    });
  });

  it("rejects missing tokens or a non-finite expiry", () => {
    expect(
      parseOAuthSession({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "soon",
      }),
    ).toBeNull();
    expect(
      parseOAuthSession({
        accessToken: "a",
        expiresAt: 1,
      }),
    ).toBeNull();
    expect(parseOAuthSession("{not json")).toBeNull();
    expect(parseOAuthSession(null)).toBeNull();
  });
});

describe("sessionNeedsRefresh", () => {
  it("is true when expiry is within two minutes", () => {
    const now = 1_000_000;
    expect(
      sessionNeedsRefresh({ expiresAt: now + XAI_OAUTH_REFRESH_SKEW_MS }, now),
    ).toBe(true);
    expect(
      sessionNeedsRefresh(
        { expiresAt: now + XAI_OAUTH_REFRESH_SKEW_MS - 1 },
        now,
      ),
    ).toBe(true);
  });

  it("is true when already expired", () => {
    expect(sessionNeedsRefresh({ expiresAt: 10 }, 50)).toBe(true);
  });

  it("is false when expiry is more than two minutes away", () => {
    const now = 1_000_000;
    expect(
      sessionNeedsRefresh(
        { expiresAt: now + XAI_OAUTH_REFRESH_SKEW_MS + 1 },
        now,
      ),
    ).toBe(false);
  });
});

describe("credentialsFromTokenResponse", () => {
  it("maps token fields and derives expiry", () => {
    const now = 5_000;
    expect(
      credentialsFromTokenResponse(
        {
          access_token: "at",
          refresh_token: "rt",
          expires_in: 30,
          id_token: jwtFromPayload({
            email: "a@x.ai",
            name: "Ada",
          }),
        },
        undefined,
        now,
      ),
    ).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: now + 30_000,
      idToken: jwtFromPayload({ email: "a@x.ai", name: "Ada" }),
      email: "a@x.ai",
      name: "Ada",
    });
  });

  it("keeps the previous refresh token when the response omits one", () => {
    const now = 10_000;
    expect(
      credentialsFromTokenResponse(
        { access_token: "new-at", expires_in: 10 },
        { refreshToken: "old-rt", email: "kept@x.ai", name: "Kept" },
        now,
      ),
    ).toEqual({
      accessToken: "new-at",
      refreshToken: "old-rt",
      expiresAt: now + 10_000,
      email: "kept@x.ai",
      name: "Kept",
    });
  });

  it("returns null without an access token or any refresh token", () => {
    expect(credentialsFromTokenResponse({ refresh_token: "rt" })).toBeNull();
    expect(
      credentialsFromTokenResponse({ access_token: "at", expires_in: 10 }),
    ).toBeNull();
  });
});

describe("emailFromIdToken", () => {
  it("reads email from the JWT payload without verifying the signature", () => {
    expect(
      emailFromIdToken(jwtFromPayload({ email: "grok@x.ai", name: "Grok" })),
    ).toBe("grok@x.ai");
  });

  it("returns undefined for missing or malformed tokens", () => {
    expect(emailFromIdToken(undefined)).toBeUndefined();
    expect(emailFromIdToken("not-a-jwt")).toBeUndefined();
    expect(emailFromIdToken("a.%%%")).toBeUndefined();
  });
});

describe("session credential split", () => {
  function bigToken(size: number, seed: string): string {
    return seed.repeat(Math.ceil(size / seed.length)).slice(0, size);
  }

  it("rejects a packed JSON blob that exceeds the Windows credential cap", () => {
    const packed = JSON.stringify({
      accessToken: bigToken(1800, "a"),
      refreshToken: bigToken(1800, "r"),
      expiresAt: 1,
      idToken: bigToken(800, "i"),
      email: "user@example.com",
      name: "Ada",
    });
    expect(packed.length).toBeGreaterThan(WIN_CREDENTIAL_MAX_CHARS);
  });

  it("stores tokens in separate entries each under the Windows cap", () => {
    const session = {
      accessToken: bigToken(1800, "a"),
      refreshToken: bigToken(1800, "r"),
      expiresAt: 99,
      idToken: bigToken(800, "i"),
      email: "user@example.com",
      name: "Ada",
    };
    const entries = sessionToCredentialEntries(session);
    expect(
      entries.every((e) => e.password.length <= WIN_CREDENTIAL_MAX_CHARS),
    ).toBe(true);
    const map = Object.fromEntries(entries.map((e) => [e.account, e.password]));
    expect(sessionFromCredentialMap(map)).toEqual({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: 99,
      email: "user@example.com",
      name: "Ada",
    });
    expect(map[XAI_OAUTH_ACCOUNT]).not.toContain("accessToken");
  });

  it("chunks a token that fits 2560 chars but exceeds the 1280 UTF-16 cap", () => {
    const session = {
      accessToken: bigToken(2000, "a"),
      refreshToken: bigToken(2000, "r"),
      expiresAt: 1,
    };
    const entries = sessionToCredentialEntries(session);
    expect(entries.length).toBeGreaterThan(3);
    expect(
      entries.every((e) => e.password.length <= WIN_CREDENTIAL_MAX_CHARS),
    ).toBe(true);
    const map = Object.fromEntries(entries.map((e) => [e.account, e.password]));
    expect(sessionFromCredentialMap(map)?.accessToken).toBe(
      session.accessToken,
    );
  });

  it("chunks a single token that itself exceeds the cap", () => {
    const session = {
      accessToken: bigToken(WIN_CREDENTIAL_MAX_CHARS + 40, "a"),
      refreshToken: "rt",
      expiresAt: 1,
    };
    const entries = sessionToCredentialEntries(session);
    expect(
      entries.every((e) => e.password.length <= WIN_CREDENTIAL_MAX_CHARS),
    ).toBe(true);
    const map = Object.fromEntries(entries.map((e) => [e.account, e.password]));
    expect(sessionFromCredentialMap(map)?.accessToken).toBe(
      session.accessToken,
    );
  });

  it("still reads a legacy combined JSON blob", () => {
    expect(
      sessionFromCredentialMap({
        [XAI_OAUTH_ACCOUNT]: JSON.stringify(validSession),
      }),
    ).toEqual(validSession);
  });
});
