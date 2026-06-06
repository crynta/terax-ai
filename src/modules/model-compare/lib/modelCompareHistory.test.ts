import { describe, expect, it } from "vitest";
import {
  type CompareCandidateInput,
  createModelCompareRun,
  voteModelCompareRun,
} from "./modelCompare";
import {
  compareRunToScoreRecord,
  modelCompareHistoryTitle,
  parseModelCompareHistory,
  parseModelCompareHistoryValue,
  serializeModelCompareHistory,
  upsertModelCompareHistory,
} from "./modelCompareHistory";

const candidates: CompareCandidateInput[] = [
  { id: "model-a", label: "Model A Real", provider: "Lab" },
  { id: "model-b", label: "Model B Real", provider: "Lab" },
];

function sampleRun(id: string) {
  return createModelCompareRun({
    id,
    prompt: "Compare this.",
    candidates,
    blind: true,
    now: 1_700_000_000_000,
  });
}

describe("model compare history", () => {
  it("upserts runs by id, sorts newest first, and enforces a limit", () => {
    const runA = sampleRun("cmp_a");
    const runB = sampleRun("cmp_b");
    const votedA = voteModelCompareRun(runA, { kind: "pane", paneId: runA.panes[1].id }, 30);

    const history = upsertModelCompareHistory(
      upsertModelCompareHistory(
        upsertModelCompareHistory([], runA, 10, 2),
        runB,
        20,
        2,
      ),
      votedA,
      30,
      2,
    );

    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.id)).toEqual(["cmp_a", "cmp_b"]);
    expect(history[0].savedAt).toBe(30);
    expect(history[0].run.vote).toEqual(votedA.vote);
  });

  it("serializes and parses only valid persisted entries", () => {
    const run = sampleRun("cmp_parse");
    const raw = serializeModelCompareHistory([
      { id: run.id, savedAt: 40, run },
    ]);
    const mixedRaw = JSON.stringify([
      { id: run.id, savedAt: 40, run },
      { id: "bad", savedAt: "nope", run },
      { id: "bad-run", savedAt: 50, run: { id: "bad-run" } },
    ]);

    expect(parseModelCompareHistory("not json")).toEqual([]);
    expect(parseModelCompareHistory(raw)).toEqual([
      { id: run.id, savedAt: 40, run },
    ]);
    expect(parseModelCompareHistory(mixedRaw)).toEqual([
      { id: run.id, savedAt: 40, run },
    ]);
    expect(
      parseModelCompareHistoryValue([
        { id: run.id, savedAt: 40, run },
        { id: "bad", savedAt: "nope", run },
        { id: run.id, savedAt: 41, run: { ...run, mode: "invalid" } },
        { id: run.id, savedAt: 42, run: { ...run, panes: run.panes.slice(0, 1) } },
      ]),
    ).toEqual([{ id: run.id, savedAt: 40, run }]);
  });

  it("builds compact history labels", () => {
    const run = voteModelCompareRun(sampleRun("cmp_title"), { kind: "tie" }, 20);
    const title = modelCompareHistoryTitle({ id: run.id, savedAt: 30, run });

    expect(title).toContain("Compare this.");
    expect(title).toContain("Tie");
  });

  it("labels prompt-variant history by mode and underlying model", () => {
    const run = createModelCompareRun({
      id: "cmp_prompt_title",
      prompt: "Prompt variant comparison",
      mode: "prompts",
      candidates: [
        {
          id: "prompt_a",
          label: "Prompt A",
          provider: "Model A Real",
          modelId: "model-a",
          prompt: "Explain briefly.",
        },
        {
          id: "prompt_b",
          label: "Prompt B",
          provider: "Model A Real",
          modelId: "model-a",
          prompt: "Explain with examples.",
        },
      ],
      blind: true,
      now: 10,
    });

    const title = modelCompareHistoryTitle({ id: run.id, savedAt: 30, run });

    expect(title).toContain("Prompt variants");
    expect(title).toContain("Model A Real");
  });

  it("turns voted runs into score records without using blind labels", () => {
    const run = sampleRun("cmp_score");
    const voted = voteModelCompareRun(
      run,
      { kind: "pane", paneId: run.panes[1].id },
      20,
    );

    expect(compareRunToScoreRecord(run)).toBeNull();
    expect(compareRunToScoreRecord(voted)).toEqual({
      models: ["Model A Real", "Model B Real"],
      winner: "Model B Real",
      costs: [null, null],
    });
  });
});
