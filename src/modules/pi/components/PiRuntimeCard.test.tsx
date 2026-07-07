import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PiRuntimeCard } from "@/modules/pi/components/PiRuntimeCard";
import { getPiStatusView, type PiRuntimeState } from "@/modules/pi/lib/status";

function renderCard(
  runtimeState: PiRuntimeState,
  runtimeAction: "starting" | "stopping" | "restarting" | null = null,
) {
  return renderToStaticMarkup(
    <PiRuntimeCard
      isBusy={runtimeAction !== null}
      runtimeAction={runtimeAction}
      runtimeState={runtimeState}
      status={getPiStatusView(runtimeState)}
      onRestart={vi.fn()}
      onStart={vi.fn()}
      onStop={vi.fn()}
    />,
  );
}

describe("PiRuntimeCard", () => {
  it("makes restart the primary recovery action when the runtime errored", () => {
    const html = renderCard({ phase: "error", detail: "spawn failed" });

    expect(html).toContain('data-primary-runtime-action="restart"');
    expect(html).toContain('aria-label="Restart Pi runtime"');
    expect(html).toContain("Restart Pi to reset the webview runtime");
  });

  it("shows action-specific copy while stopping the runtime", () => {
    const html = renderCard({ phase: "ready", detail: null }, "stopping");

    expect(html).toContain("Stopping Pi runtime…");
    expect(html).toContain("Stopping…");
  });
});
