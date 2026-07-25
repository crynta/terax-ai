# Notification Dropdown Destination-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Terax bell-dropdown notification rows so the destination appears first as a space badge plus tab title.

**Architecture:** Keep the change local to the agent notification frontend. Add a tiny pure helper for destination formatting so fallback behavior is covered by tests, then update `NotificationRow` to render the destination-first layout.

**Tech Stack:** React 19, TypeScript, Vitest, Tailwind utility classes, Hugeicons.

## Global Constraints

- Do not add third-party UI dependencies.
- Preserve existing full-row click behavior.
- Keep the row compact and truncate long tab titles.
- Fall back cleanly when `spaceId` and/or `tabTitle` are missing.
- Do not commit changes unless the user explicitly asks.

---

## File Structure

- Create: `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/lib/notificationDestination.ts`
  - Pure helper that formats optional space/tab metadata into a small view model.
- Create: `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/lib/notificationDestination.test.ts`
  - Vitest coverage for both-full-data and fallback cases.
- Modify: `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/components/NotificationBell.tsx`
  - Render Option B: destination-first row with space pill, prominent tab title, agent/status below.

---

### Task 1: Destination-first notification row

**Files:**
- Create: `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/lib/notificationDestination.ts`
- Create: `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/lib/notificationDestination.test.ts`
- Modify: `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/components/NotificationBell.tsx:135-205`

**Interfaces:**
- Consumes: `tabTitle?: string`, `spaceName?: string`
- Produces:
  - `type NotificationDestination = { spaceLabel?: string; tabTitle?: string; hasDestination: boolean }`
  - `function formatNotificationDestination(input: { spaceName?: string; tabTitle?: string }): NotificationDestination`

- [ ] **Step 1: Write the failing helper tests**

Create `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/lib/notificationDestination.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatNotificationDestination } from "./notificationDestination";

describe("formatNotificationDestination", () => {
  it("returns an uppercase space label and trimmed tab title when both exist", () => {
    expect(
      formatNotificationDestination({
        spaceName: "Main",
        tabTitle: " Space_Terax ",
      }),
    ).toEqual({
      spaceLabel: "MAIN",
      tabTitle: "Space_Terax",
      hasDestination: true,
    });
  });

  it("falls back to tab title only", () => {
    expect(
      formatNotificationDestination({ tabTitle: "lesson-04" }),
    ).toEqual({
      tabTitle: "lesson-04",
      hasDestination: true,
    });
  });

  it("falls back to space only", () => {
    expect(formatNotificationDestination({ spaceName: "School" })).toEqual({
      spaceLabel: "SCHOOL",
      hasDestination: true,
    });
  });

  it("reports no destination when both values are blank", () => {
    expect(
      formatNotificationDestination({ spaceName: " ", tabTitle: "" }),
    ).toEqual({ hasDestination: false });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run src/modules/agents/lib/notificationDestination.test.ts
```

Expected: FAIL because `./notificationDestination` does not exist yet.

- [ ] **Step 3: Implement the helper**

Create `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/lib/notificationDestination.ts`:

```ts
export type NotificationDestination = {
  spaceLabel?: string;
  tabTitle?: string;
  hasDestination: boolean;
};

export function formatNotificationDestination({
  spaceName,
  tabTitle,
}: {
  spaceName?: string;
  tabTitle?: string;
}): NotificationDestination {
  const trimmedSpaceName = spaceName?.trim();
  const trimmedTabTitle = tabTitle?.trim();

  const destination: NotificationDestination = {
    hasDestination: Boolean(trimmedSpaceName || trimmedTabTitle),
  };

  if (trimmedSpaceName) {
    destination.spaceLabel = trimmedSpaceName.toLocaleUpperCase();
  }

  if (trimmedTabTitle) {
    destination.tabTitle = trimmedTabTitle;
  }

  return destination;
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm vitest run src/modules/agents/lib/notificationDestination.test.ts
```

Expected: PASS, 4 tests pass.

- [ ] **Step 5: Update the notification row layout**

Modify `/Users/spacedmanhome/Documents/dev/Space_Terax/src/modules/agents/components/NotificationBell.tsx`:

```tsx
import { formatNotificationDestination } from "../lib/notificationDestination";
```

Inside `NotificationRow`, after resolving `spaceMeta`, add:

```tsx
  const destination = formatNotificationDestination({
    spaceName: spaceMeta?.name,
    tabTitle: n.tabTitle,
  });
```

Replace the inner content block with:

```tsx
      <div className="min-w-0 flex-1">
        {destination.hasDestination && (
          <div className="mb-1 flex min-w-0 items-center gap-1.5">
            {destination.spaceLabel && (
              <span className="max-w-20 shrink-0 truncate rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide text-primary">
                {destination.spaceLabel}
              </span>
            )}
            {destination.tabTitle && (
              <span className="min-w-0 truncate text-xs font-semibold leading-tight text-foreground/90">
                {destination.tabTitle}
              </span>
            )}
          </div>
        )}
        <div
          className={cn(
            "flex items-center gap-1.5 text-sm text-foreground",
            destination.hasDestination && "text-xs text-muted-foreground",
          )}
        >
          <span className="truncate">{displayAgent(n.agent)}</span>{" "}
          <span className="shrink-0 text-muted-foreground">
            {NOTIF_LABEL[n.kind]}
          </span>
        </div>
      </div>
```

- [ ] **Step 6: Run validation**

Run:

```bash
pnpm vitest run src/modules/agents/lib/notificationDestination.test.ts
pnpm check-types
```

Expected: helper tests pass and TypeScript reports no errors.

- [ ] **Step 7: Manual verification**

In the running Terax app, open the bell dropdown after a new agent notification is created.

Expected:

```text
[status] [SPACE] Tab title                     time
         agent status
```

If a row has no destination metadata, it should still show `agent status` without an empty first line.

---

## Self-Review

- Spec coverage: The task implements destination-first rows, space badge, tab title, agent/status second line, compact truncation, timestamp preservation, and fallback behavior.
- Placeholder scan: No placeholders or deferred decisions remain.
- Type consistency: `formatNotificationDestination` returns the same `NotificationDestination` shape used by the React row.
