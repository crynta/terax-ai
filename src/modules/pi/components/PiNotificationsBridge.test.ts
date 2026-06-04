import { describe, expect, it, vi } from "vitest";
import {
  createPiNotificationProcessorState,
  processPiNotificationEvent,
} from "@/modules/pi/components/PiNotificationsBridge";
import type { PiSessionEvent } from "@/modules/pi/lib/sessions";

function event(
  id: string,
  type: string,
  payload: PiSessionEvent["payload"],
): PiSessionEvent {
  return {
    id,
    type,
    sessionId: "pi-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    payload,
  };
}

describe("processPiNotificationEvent", () => {
  it("routes Pi session errors through the shared notification bell", () => {
    const routeNotification = vi.fn();
    const setPiSession = vi.fn();
    const onActivateSession = vi.fn();

    processPiNotificationEvent({
      event: event("evt-error", "session.error", {
        message: "Selected Pi model is not available",
      }),
      focused: false,
      onActivateSession,
      removePiSession: vi.fn(),
      routeNotification,
      setPiSession,
      state: createPiNotificationProcessorState(),
      visible: false,
    });

    expect(setPiSession).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Selected Pi model is not available",
        sessionId: "pi-1",
        status: "error",
      }),
    );
    expect(routeNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "Pi",
        allowToast: true,
        body: "Selected Pi model is not available",
        kind: "error",
        piSessionId: "pi-1",
        source: "pi",
        title: "Pi run failed",
      }),
    );

    const route = routeNotification.mock.calls[0][0];
    route.onActivate();
    expect(onActivateSession).toHaveBeenCalledWith("pi-1");
  });

  it("deduplicates repeated Pi notification events", () => {
    const routeNotification = vi.fn();
    const state = createPiNotificationProcessorState();
    const input = {
      event: event("evt-error", "session.error", { message: "Boom" }),
      focused: true,
      onActivateSession: vi.fn(),
      removePiSession: vi.fn(),
      routeNotification,
      setPiSession: vi.fn(),
      state,
      visible: true,
    };

    processPiNotificationEvent(input);
    processPiNotificationEvent(input);

    expect(routeNotification).toHaveBeenCalledTimes(1);
  });
});
