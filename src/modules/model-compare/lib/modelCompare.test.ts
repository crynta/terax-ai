import { describe, expect, it } from "vitest";
import { compatModelIdForEndpoint } from "@/modules/ai/config";
import {
  aggregateModelCompareScores,
  applyModelCompareEvaluation,
  buildCompareArtifactMarkdown,
  buildCompareCandidates,
  buildModelCompareJudgePrompt,
  type CompareCandidateInput,
  createModelCompareRun,
  formatModelCompareEvaluationWinner,
  parseModelCompareJudgeResult,
  revealModelCompareRun,
  voteModelCompareRun,
} from "./modelCompare";

const candidates: CompareCandidateInput[] = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "OpenAI" },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
  },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "Google" },
];

describe("createModelCompareRun", () => {
  it("creates blind neutral slots without leaking model names", () => {
    const run = createModelCompareRun({
      id: "cmp_1",
      prompt: "Explain CRDTs in 3 bullets.",
      candidates: candidates.slice(0, 2),
      blind: true,
      now: 1_700_000_000_000,
    });

    expect(run.panes.map((pane) => pane.slotLabel)).toEqual([
      "Model A",
      "Model B",
    ]);
    expect(run.panes.map((pane) => pane.visibleLabel)).toEqual([
      "Model A",
      "Model B",
    ]);
    expect(JSON.stringify(run.publicSnapshot)).not.toContain("GPT-5.4");
    expect(JSON.stringify(run.publicSnapshot)).not.toContain("Claude");
  });

  it("rejects compare runs outside Terax's lightweight 2-4 model budget", () => {
    expect(() =>
      createModelCompareRun({
        id: "cmp_too_few",
        prompt: "hello",
        candidates: candidates.slice(0, 1),
        blind: true,
        now: 1,
      }),
    ).toThrow("Select 2 to 4 models");

    expect(() =>
      createModelCompareRun({
        id: "cmp_too_many",
        prompt: "hello",
        candidates: [...candidates, ...candidates],
        blind: true,
        now: 1,
      }),
    ).toThrow("Select 2 to 4 models");
  });
});

describe("voteModelCompareRun", () => {
  it("locks one vote, reveals labels, and maps winner to the underlying candidate", () => {
    const run = createModelCompareRun({
      id: "cmp_vote",
      prompt: "Pick a database.",
      candidates: candidates.slice(0, 2),
      blind: true,
      now: 10,
    });

    const voted = voteModelCompareRun(
      run,
      { kind: "pane", paneId: run.panes[1].id },
      20,
    );

    expect(voted.vote).toEqual({
      kind: "pane",
      paneId: run.panes[1].id,
      candidateId: "claude-sonnet-4-6",
      votedAt: 20,
    });
    expect(voted.revealed).toBe(true);
    expect(voted.panes.map((pane) => pane.visibleLabel)).toEqual([
      "GPT-5.4 mini",
      "Claude Sonnet 4.6",
    ]);
    expect(() => voteModelCompareRun(voted, { kind: "tie" }, 30)).toThrow(
      "already has a vote",
    );
  });

  it("supports reveal without recording a vote", () => {
    const run = createModelCompareRun({
      id: "cmp_reveal",
      prompt: "Compare summaries.",
      candidates: candidates.slice(0, 2),
      blind: true,
      now: 10,
    });

    const revealed = revealModelCompareRun(run);

    expect(revealed.vote).toBeNull();
    expect(revealed.revealed).toBe(true);
    expect(revealed.panes.map((pane) => pane.visibleLabel)).toEqual([
      "GPT-5.4 mini",
      "Claude Sonnet 4.6",
    ]);
  });
});

describe("prompt compare mode", () => {
  it("allows unique prompt variants to reuse the same underlying model", () => {
    const run = createModelCompareRun({
      id: "cmp_prompts",
      prompt: "Prompt variant comparison",
      mode: "prompts",
      candidates: [
        {
          id: "prompt_a",
          label: "Prompt A",
          provider: "OpenAI",
          modelId: "gpt-5.4-mini",
          prompt: "Explain quickly.",
        },
        {
          id: "prompt_b",
          label: "Prompt B",
          provider: "OpenAI",
          modelId: "gpt-5.4-mini",
          prompt: "Explain with examples.",
        },
      ],
      blind: true,
      now: 1,
    });

    expect(run.mode).toBe("prompts");
    expect(run.panes.map((pane) => pane.candidate.modelId)).toEqual([
      "gpt-5.4-mini",
      "gpt-5.4-mini",
    ]);
    expect(run.panes.map((pane) => pane.candidate.prompt)).toEqual([
      "Explain quickly.",
      "Explain with examples.",
    ]);
    expect(JSON.stringify(run.publicSnapshot)).not.toContain("gpt-5.4-mini");
  });
});

describe("model compare judge", () => {
  it("builds and parses a rubric-based judge result", () => {
    const started = createModelCompareRun({
      id: "cmp_judge",
      prompt: "Explain CRDTs.",
      candidates: candidates.slice(0, 2),
      blind: true,
      now: 1,
    });
    const withResponses = {
      ...started,
      panes: started.panes.map((pane, index) => ({
        ...pane,
        status: "completed" as const,
        response: index === 0 ? "Short answer" : "Detailed accurate answer",
      })),
    };

    const judgePrompt = buildModelCompareJudgePrompt(
      withResponses,
      "Prefer correctness, specificity, and concise reasoning.",
    );
    expect(judgePrompt).toContain("Prefer correctness");
    expect(judgePrompt).toContain("pane_1");
    expect(judgePrompt).toContain("Model A");
    expect(judgePrompt).not.toContain("GPT-5.4 mini");
    expect(
      buildModelCompareJudgePrompt(
        revealModelCompareRun(withResponses),
        "Prefer correctness.",
      ),
    ).not.toContain("GPT-5.4 mini");

    const evaluation = parseModelCompareJudgeResult(
      '{"winner":"pane_2","summary":"B is stronger","scores":[{"paneId":"pane_1","score":6,"rationale":"Too brief"},{"paneId":"pane_2","score":9,"rationale":"More complete"}]}',
      withResponses,
      20,
    );
    const evaluated = applyModelCompareEvaluation(withResponses, evaluation);

    expect(evaluation.winner).toBe("pane_2");
    expect(formatModelCompareEvaluationWinner(evaluated)).toBe("Model B");
    expect(
      formatModelCompareEvaluationWinner(revealModelCompareRun(evaluated)),
    ).toBe("Claude Sonnet 4.6");
    expect(evaluated.evaluation?.summary).toBe("B is stronger");
    expect(evaluated.publicSnapshot.evaluation?.scores).toHaveLength(2);
  });
});

describe("buildCompareArtifactMarkdown", () => {
  it("exports prompt, winner, metrics, and model responses", () => {
    const started = createModelCompareRun({
      id: "cmp_artifact",
      prompt: "What makes a good terminal?",
      candidates: candidates.slice(0, 2),
      blind: true,
      now: 100,
    });
    const withResponses = {
      ...started,
      panes: started.panes.map((pane, index) => ({
        ...pane,
        status: "completed" as const,
        response:
          index === 0
            ? "Fast keyboard-first UX."
            : "Reliable pty and clear feedback.",
        metrics: {
          startedAt: 100,
          completedAt: 250 + index * 50,
          latencyMs: 150 + index * 50,
          inputTokens: 20,
          outputTokens: 8 + index,
          cachedInputTokens: 0,
          costUsd: index === 0 ? 0.00002 : null,
        },
      })),
    };
    const voted = voteModelCompareRun(withResponses, { kind: "tie" }, 500);

    const evaluated = applyModelCompareEvaluation(voted, {
      judgedAt: 600,
      judgeModelId: "judge-model",
      rubric: "Correctness first.",
      winner: "pane_2",
      summary: "The second response is more actionable.",
      scores: [
        { paneId: "pane_1", score: 7, rationale: "Useful but terse." },
        { paneId: "pane_2", score: 9, rationale: "More complete." },
      ],
    });
    const markdown = buildCompareArtifactMarkdown(evaluated);

    expect(markdown).toContain("# Model Compare");
    expect(markdown).toContain("**Prompt:** What makes a good terminal?");
    expect(markdown).toContain("**Winner:** Tie");
    expect(markdown).toContain("## GPT-5.4 mini");
    expect(markdown).toContain("150ms");
    expect(markdown).toContain("Fast keyboard-first UX.");
    expect(markdown).toContain("Reliable pty and clear feedback.");
    expect(markdown).toContain("## Judge Evaluation");
    expect(markdown).toContain("**Winner:** Claude Sonnet 4.6");
    expect(markdown).toContain("The second response is more actionable.");
  });
});

describe("buildCompareCandidates", () => {
  it("returns only configured models and custom endpoints without exposing secrets", () => {
    const built = buildCompareCandidates({
      keys: {
        openai: "sk-openai",
        anthropic: null,
        google: null,
        xai: null,
        cerebras: null,
        groq: null,
        deepseek: null,
        mistral: null,
        openrouter: "sk-or-test",
        "openai-compatible": null,
      },
      localModels: {
        lmstudioModelId: "qwen2.5-coder",
        mlxModelId: "",
        ollamaModelId: "llama3.2",
        openaiCompatibleModelId: "",
        openrouterModelId: "anthropic/claude-sonnet-4.5",
      },
      customEndpoints: [
        {
          id: "ep_a",
          name: "Lab",
          baseURL: "http://127.0.0.1:9000/v1",
          modelId: "lab-model",
          contextLimit: 8192,
        },
        {
          id: "ep_empty",
          name: "Empty",
          baseURL: "",
          modelId: "",
          contextLimit: 8192,
        },
      ],
    });

    expect(built.map((candidate) => candidate.id)).toContain("gpt-5.4-mini");
    expect(built.map((candidate) => candidate.id)).toContain("lmstudio-local");
    expect(built.map((candidate) => candidate.id)).toContain("ollama-local");
    expect(built.map((candidate) => candidate.id)).toContain(
      "openrouter-custom",
    );
    expect(built.map((candidate) => candidate.id)).toContain(
      compatModelIdForEndpoint("ep_a"),
    );
    expect(built.map((candidate) => candidate.id)).not.toContain(
      "claude-sonnet-4-6",
    );
    expect(JSON.stringify(built)).not.toContain("sk-openai");
  });
});

describe("aggregateModelCompareScores", () => {
  it("aggregates wins, losses, ties, and average cost per model", () => {
    const scores = aggregateModelCompareScores([
      { models: ["A", "B"], winner: "A", costs: [0.01, 0.02] },
      { models: ["A", "B"], winner: "tie", costs: [0.03, 0.04] },
      { models: ["A", "C"], winner: "C", costs: [null, 0.02] },
    ]);

    expect(scores).toEqual([
      {
        model: "C",
        wins: 1,
        losses: 0,
        ties: 0,
        games: 1,
        winRate: 1,
        averageCostUsd: 0.02,
      },
      {
        model: "A",
        wins: 1,
        losses: 1,
        ties: 1,
        games: 3,
        winRate: 1 / 3,
        averageCostUsd: 0.02,
      },
      {
        model: "B",
        wins: 0,
        losses: 1,
        ties: 1,
        games: 2,
        winRate: 0,
        averageCostUsd: 0.03,
      },
    ]);
  });
});
