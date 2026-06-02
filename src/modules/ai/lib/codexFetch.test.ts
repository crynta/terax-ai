import { describe, expect, it } from "vitest";
import { prepareCodexProxyRequest } from "./codexFetch";

describe("prepareCodexProxyRequest", () => {
  it("strips bearer and cookie material before invoking Rust", async () => {
    const req = await prepareCodexProxyRequest(
      "https://chatgpt.com/backend-api/codex/responses",
      {
        method: "POST",
        headers: {
          authorization: "Bearer fake",
          cookie: "session=fake",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );

    expect(req.method).toBe("POST");
    expect(req.headers).toEqual({ "content-type": "application/json" });
    expect(req.body).toEqual(Array.from(new TextEncoder().encode("{}")));
  });
});
