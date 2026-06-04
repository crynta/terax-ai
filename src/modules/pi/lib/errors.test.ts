import { describe, expect, it } from "vitest";
import { formatPiErrorDetail } from "@/modules/pi/lib/errors";

describe("formatPiErrorDetail", () => {
  it("uses structured remediation from Pi command errors", () => {
    expect(
      formatPiErrorDetail({
        message: "Pi host error -32006: Pi host supports at most 20 sessions",
        code: "PI_RESOURCE_LIMIT",
        category: "resource_limit",
        retryable: false,
        remediation:
          "Close older Pi sessions or shorten the prompt, then try again.",
      }),
    ).toBe(
      "Pi host error -32006: Pi host supports at most 20 sessions\nClose older Pi sessions or shorten the prompt, then try again.",
    );
  });
});
