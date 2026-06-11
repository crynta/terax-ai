/**
 * PiUsageCard — shows cumulative token/cost usage for the selected session.
 *
 * Fetches usage summary from the backend and renders a compact breakdown.
 */

import { useEffect, useMemo, useState } from "react";
import {
  PiSection,
  type PiSectionShellProps,
} from "@/modules/pi/components/PiSection";
import type { PiUsageSummary } from "@/modules/pi/lib/sessions";
import { getSessionBackend } from "@/modules/pi/lib/pi-session-backend";
import { estimateCost } from "@/modules/ai/config";

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function PiUsageCard({
  sessionId,
  collapsed: collapsedProp,
  onCollapsedChange,
}: Pick<PiSectionShellProps, "collapsed" | "disabled" | "onCollapsedChange"> & {
  sessionId: string | null;
}) {
  const [summary, setSummary] = useState<PiUsageSummary | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    getSessionBackend()
      .usageSummary(sessionId)
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /**
   * Re-estimate cost when backend reports $0 but tokens were used.
   * This covers sidecar sessions where costUsd is not computed server-side.
   */
  const effectiveSummary = useMemo(() => {
    if (!summary) return null;
    const hasTokens =
      summary.totalInputTokens > 0 || summary.totalOutputTokens > 0;
    // Only re-estimate when: no cost was computed AND tokens were used AND we have per-model data.
    // This handles sidecar sessions where costUsd is null (becomes 0 after Rust unwrap_or).
    // For legitimately free models, estimateCost returns null → cost stays 0.
    // Note: We cannot distinguish "cost not computed" from "legitimately $0" from the summary alone,
    // so we re-estimate conservatively — estimateCost returns null for unknown/free models.
    if (
      summary.totalCostUsd > 0 ||
      !hasTokens ||
      !summary.byModel ||
      summary.byModel.length === 0
    )
      return summary;

    // Check if ANY model has a non-null cost estimate — if so, the cost was computed
    const anyEstimated = summary.byModel.some(
      (model) =>
        estimateCost(model.modelId, {
          inputTokens: model.inputTokens,
          outputTokens: model.outputTokens,
          cachedInputTokens: model.cachedInputTokens,
        }) !== null,
    );
    if (!anyEstimated) return summary; // All models unknown/free — can't estimate

    // Re-estimate from per-model token counts
    let totalCost = 0;
    const updatedModels = summary.byModel.map((model) => {
      const cost = estimateCost(model.modelId, {
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cachedInputTokens: model.cachedInputTokens,
      });
      totalCost += cost ?? 0;
      return { ...model, costUsd: cost ?? 0 };
    });

    return { ...summary, totalCostUsd: totalCost, byModel: updatedModels };
  }, [summary]);

  if (!effectiveSummary || effectiveSummary.turnCount === 0) return null;

  return (
    <PiSection
      title="Usage"
      collapsed={collapsedProp}
      summary={
        <span className="text-[9.5px] text-muted-foreground">
          {formatTokenCount(
            effectiveSummary.totalInputTokens +
              effectiveSummary.totalOutputTokens,
          )}{" "}
          tokens · {formatCost(effectiveSummary.totalCostUsd)}
        </span>
      }
      onCollapsedChange={onCollapsedChange}
    >
      <div className="flex flex-col gap-1.5 px-2 pb-2">
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-muted-foreground">Input tokens</span>
          <span className="font-medium tabular-nums">
            {effectiveSummary.totalInputTokens.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-muted-foreground">Output tokens</span>
          <span className="font-medium tabular-nums">
            {effectiveSummary.totalOutputTokens.toLocaleString()}
          </span>
        </div>
        {effectiveSummary.totalCachedInputTokens > 0 ? (
          <div className="flex items-center justify-between text-[10.5px]">
            <span className="text-muted-foreground">Cached input</span>
            <span className="font-medium tabular-nums">
              {effectiveSummary.totalCachedInputTokens.toLocaleString()}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-muted-foreground">Cost</span>
          <span className="font-medium tabular-nums">
            {formatCost(effectiveSummary.totalCostUsd)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10.5px]">
          <span className="text-muted-foreground">Turns</span>
          <span className="font-medium tabular-nums">
            {effectiveSummary.turnCount}
          </span>
        </div>
        {effectiveSummary.byModel && effectiveSummary.byModel.length > 0 ? (
          <>
            <div className="mt-1 border-t border-border/25 pt-1.5 text-[10px] font-medium text-muted-foreground">
              Per model
            </div>
            {effectiveSummary.byModel.map((model) => (
              <div
                key={model.modelId}
                className="flex flex-col gap-0.5 rounded-md border border-border/25 px-2 py-1"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="truncate font-medium" title={model.modelId}>
                    {model.modelId}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCost(model.costUsd)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[9.5px] text-muted-foreground">
                  <span>
                    {formatTokenCount(model.inputTokens)} in /{" "}
                    {formatTokenCount(model.outputTokens)} out
                  </span>
                  <span>{model.turnCount} turns</span>
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </PiSection>
  );
}
