import { describe, it, expect } from "vitest";

const API_KEY = process.env.MINIMAX_API_KEY;
const BASE_URL = "https://api.minimax.io/v1";

describe.skipIf(!API_KEY)("MiniMax E2E", () => {
  it(
    "completes basic chat via OpenAI-compatible endpoint",
    async () => {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: "MiniMax-M2.7",
          messages: [{ role: "user", content: 'Say "test passed"' }],
          max_tokens: 20,
          temperature: 1.0,
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.choices[0].message.content).toBeTruthy();
    },
    30000,
  );
});
