import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PiDiagnosticsCard } from "@/modules/pi/components/PiDiagnosticsCard";
import type { PiDiagnosticsView } from "@/modules/pi/lib/diagnostics";

const baseView: PiDiagnosticsView = {
  apiKeyCount: 1,
  capabilityLabel: "Tools enabled",
  configuredApiKeyCount: 1,
  debugDetail: null,
  diagnosticsText: "Pi diagnostics\nStatus: Review",
  healthy: false,
  idlePolicyLabel: "10m idle",
  issues: [
    {
      id: "runtime-error",
      title: "Pi runtime failed",
      description: "Restart Pi to launch a fresh sidecar.",
      action: "restart-runtime",
      actionLabel: "Restart",
      tone: "destructive",
    },
  ],
  loadedPackageCount: 1,
  methodCount: 4,
  modelLabel: "Claude",
  nodeLabel: "v24 darwin/arm64",
  packageCount: 1,
  promptLimitLabel: "20,000 chars",
  providerKeyLabel: "Configured",
  providerLabel: "Anthropic",
  sessionCount: 1,
  storageLabel: "rust-app-data-json+pi-sdk-jsonl",
  summaryDescription: "Restart Pi to launch a fresh sidecar.",
  summaryTitle: "Pi runtime failed",
  toolMode: "rust-mediated",
};

describe("PiDiagnosticsCard", () => {
  it("shows a top issue summary and copy diagnostics action", () => {
    const html = renderToStaticMarkup(
      <PiDiagnosticsCard
        collapsed={false}
        disabled={false}
        refreshing={false}
        view={baseView}
        onCollapsedChange={vi.fn()}
        onOpenSettings={vi.fn()}
        onRefresh={vi.fn()}
        onRestartRuntime={vi.fn()}
        onStartRuntime={vi.fn()}
      />,
    );

    expect(html).toContain("Pi runtime failed");
    expect(html).toContain("Restart Pi to launch a fresh sidecar.");
    expect(html).toContain('aria-label="Copy Pi diagnostics"');
    expect(html).toContain("Copy");
  });

  it("renders optional sidecar stderr detail in a disclosure", () => {
    const html = renderToStaticMarkup(
      <PiDiagnosticsCard
        collapsed={false}
        disabled={false}
        refreshing={false}
        view={{ ...baseView, debugDetail: "boot failed" }}
        onCollapsedChange={vi.fn()}
        onOpenSettings={vi.fn()}
        onRefresh={vi.fn()}
        onRestartRuntime={vi.fn()}
        onStartRuntime={vi.fn()}
      />,
    );

    expect(html).toContain("Sidecar stderr tail");
    expect(html).toContain("boot failed");
  });
});
