# Notification Dropdown Destination-First Design

## Goal

Make each Terax bell-dropdown notification clearly answer: “Where will this click take me?” before the user reads the agent name or action status.

## Selected approach

Use a destination-first row layout:

```text
[status icon]  [SPACE] Tab title                    time
               agent status
```

Example:

```text
●  MAIN   Space_Terax                               now
   codex needs input
```

## Row structure

- Keep the existing left status indicator:
  - check icon for finished notifications
  - small dot for attention/error notifications
- Show destination on the first content line:
  - space name as a compact uppercase pill/badge
  - tab title as the primary location label next to the pill
- Show agent activity on the second content line:
  - agent display name
  - notification status label, such as `needs input`, `finished`, or `errored`
- Keep the timestamp right-aligned.

## Fallback behavior

Some notifications may not include `spaceId` or `tabTitle`, especially older notifications or local-agent events.

- If both space and tab title exist, show `[SPACE] Tab title`.
- If only tab title exists, show the tab title as the first-line destination.
- If only space exists, show the space pill as the first-line destination.
- If neither exists, fall back to the simple existing row: `agent status` with timestamp.

## Visual constraints

- Keep rows compact; do not wrap long tab titles.
- Truncate long tab titles with ellipsis.
- Make the destination more visually prominent than the agent/status line.
- Avoid adding noisy icons next to every text segment; the space pill should provide the main visual anchor.
- Preserve hover behavior and full-row click target.

## Data flow

The current notification flow already carries the required metadata:

- `tabTitle?: string`
- `spaceId?: string`

The dropdown row can resolve `spaceId` through the spaces store to display the space name. No backend changes are required for this layout refinement.

## Testing

Verify with frontend type checking and existing tests:

```bash
npx tsc --noEmit
```

Manual checks:

- New notification with both space and tab title shows destination-first layout.
- New notification with only tab title still looks useful.
- New notification with no destination metadata still renders cleanly.
- Clicking a row still activates the correct tab/agent location.
