import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  filterPiSessions,
  nextPiSessionDeleteConfirmationId,
  PiSessionList,
  reconcilePiSessionDeleteConfirmationId,
} from "@/modules/pi/components/PiSessionList";
import type { PiSession } from "@/modules/pi/lib/sessions";

function session(input: Partial<PiSession> & Pick<PiSession, "id">): PiSession {
  return {
    id: input.id,
    title: input.title ?? input.id,
    cwd: input.cwd ?? "/Users/me/project",
    status: input.status ?? "idle",
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
    lastPrompt: input.lastPrompt ?? null,
    sdkSessionFile: input.sdkSessionFile,
  };
}

function renderList(
  sessions: PiSession[],
  options: { canCreateSession?: boolean } = {},
) {
  return renderToStaticMarkup(
    <PiSessionList
      collapsed={false}
      disabled={false}
      status={{
        phase: "ready",
        canCreateSession: options.canCreateSession ?? true,
      }}
      selectedSessionId={sessions[0]?.id ?? null}
      sessions={sessions}
      workspaceRoot="/Users/me/project"
      onCollapsedChange={() => {}}
      onCreateSession={() => {}}
      onDeleteSession={() => {}}
      onRenameSession={() => {}}
      onResumeSession={() => {}}
      onArchiveSession={() => {}}
      onRestoreSession={() => {}}
      onSelectSession={() => {}}
    />,
  );
}

describe("PiSessionList", () => {
  it("orders sessions by most recent update and shows prompt previews", () => {
    const html = renderList([
      session({
        id: "old",
        title: "Old session",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastPrompt: "older prompt",
      }),
      session({
        id: "new",
        title: "New session",
        updatedAt: "2026-01-01T00:05:00.000Z",
        lastPrompt: "newest prompt with details",
      }),
    ]);

    expect(html.indexOf("New session")).toBeLessThan(
      html.indexOf("Old session"),
    );
    expect(html).toContain("newest prompt with details");
    expect(html).toContain("Jan 1");
  });

  it("labels session options with status and latest prompt for screen readers", () => {
    const html = renderList([
      session({
        id: "pi-1",
        title: "Debug auth",
        status: "error",
        lastPrompt: "Why did auth fail?",
      }),
    ]);

    expect(html).toContain(
      'aria-label="Debug auth, error, Why did auth fail?"',
    );
  });

  it("renders rename and delete actions for selected sessions", () => {
    const html = renderList([session({ id: "pi-1", title: "Planning" })]);

    expect(html).toContain('aria-label="Rename Pi session Planning"');
    expect(html).toContain('aria-label="Delete Pi session Planning"');
  });

  it("offers resume for stopped sessions with SDK history", () => {
    const html = renderList([
      session({
        id: "pi-1",
        title: "Planning",
        status: "stopped",
        sdkSessionFile: "/Users/me/app/pi-sdk-sessions/session.jsonl",
      }),
    ]);

    expect(html).toContain('aria-label="Resume Pi session Planning"');
    expect(html).toContain("Resume");
  });

  it("disables stopped-session new when session creation is unavailable", () => {
    const html = renderList(
      [
        session({
          id: "pi-1",
          title: "Planning",
          status: "stopped",
          sdkSessionFile: null,
        }),
      ],
      { canCreateSession: false },
    );

    expect(html).toContain(
      'aria-label="Continue Pi session Planning in a new session"',
    );
    const continueButton = html.match(
      /<button[^>]*aria-label="Continue Pi session Planning in a new session"[^>]*>/,
    )?.[0];
    expect(continueButton).toContain('disabled=""');
  });

  it("keeps option semantics on the focusable session button", () => {
    const html = renderList([session({ id: "pi-1", title: "Planning" })]);

    expect(html).toContain('<button type="button" role="option"');
    expect(html).not.toContain('<div role="option"');
  });

  it("requires a visible inline confirmation before deleting", () => {
    expect(nextPiSessionDeleteConfirmationId(null, "pi-1")).toEqual({
      nextSessionId: "pi-1",
      shouldDelete: false,
    });
    expect(nextPiSessionDeleteConfirmationId("pi-1", "pi-1")).toEqual({
      nextSessionId: null,
      shouldDelete: true,
    });
    expect(nextPiSessionDeleteConfirmationId("pi-1", "pi-2")).toEqual({
      nextSessionId: "pi-2",
      shouldDelete: false,
    });
  });

  it("clears stale delete confirmation when session selection changes", () => {
    expect(reconcilePiSessionDeleteConfirmationId("pi-1", "pi-1")).toBe("pi-1");
    expect(reconcilePiSessionDeleteConfirmationId("pi-1", "pi-2")).toBeNull();
    expect(reconcilePiSessionDeleteConfirmationId("pi-1", null)).toBeNull();
  });

  it("filters sessions by title, status, cwd, and latest prompt", () => {
    const sessions = [
      session({ id: "auth", title: "Debug auth", status: "error" }),
      session({ id: "docs", cwd: "/Users/me/docs-site" }),
      session({ id: "prompt", lastPrompt: "Explain feature flags" }),
    ];

    expect(filterPiSessions(sessions, "debug").map((item) => item.id)).toEqual([
      "auth",
    ]);
    expect(filterPiSessions(sessions, "error").map((item) => item.id)).toEqual([
      "auth",
    ]);
    expect(
      filterPiSessions(sessions, "docs-site").map((item) => item.id),
    ).toEqual(["docs"]);
    expect(
      filterPiSessions(sessions, "feature flags").map((item) => item.id),
    ).toEqual(["prompt"]);
  });
});
