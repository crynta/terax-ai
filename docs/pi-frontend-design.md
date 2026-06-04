# Pi frontend design contract

This document captures the Terax sidebar design system that Pi must follow. It is based on the existing Files and Git sidebar panels, shared UI primitives, and global theme tokens.

## Scope

Pi frontend additions include:

- `src/modules/pi/PiPanel.tsx`
- `src/modules/pi/components/*`
- `src/modules/pi/lib/*` view models that produce UI labels and states
- Pi entries in `src/modules/sidebar/*`
- agent status surfaces that include Pi activity
- Pi model/profile controls in Settings

## Baseline panels

Use these files as the live reference before changing Pi UI:

- `src/modules/explorer/FileExplorer.tsx`
- `src/modules/explorer/TreeRow.tsx`
- `src/modules/explorer/ExplorerSearch.tsx`
- `src/modules/source-control/SourceControlPanel.tsx`
- `src/modules/sidebar/SidebarRail.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/empty.tsx`
- `src/styles/globals.css`

## Sidebar shell

- Sidebar panel chrome is full-height flex, `bg-card` or `bg-card/80`, with subtle `border-border/40` to `border-border/60` separators.
- The sidebar rail is fixed at `36px`, uses `bg-card/85`, `backdrop-blur`, `px-1.5`, `py-1`, and `gap-1`.
- Pi panels should not introduce a separate palette, font, icon set, or surface treatment.

## Color system

Use semantic tokens only:

- Backgrounds: `bg-card`, `bg-card/60`, `bg-card/80`, `bg-background/70`, `bg-background/95`, `bg-muted/35`
- Text: `text-foreground`, `text-foreground/80`, `text-muted-foreground`, `text-muted-foreground/70`
- Borders: `border-border/35`, `border-border/40`, `border-border/55`, `border-border/60`
- Errors: `text-destructive`, `border-destructive/35`, `bg-destructive/10`

Avoid raw color families such as `bg-blue-*`, `text-emerald-*`, `border-amber-*`, and provider-brand colors inside the Pi sidebar. Git file status colors are an exception owned by the Git panel.

## Typography

The sidebar is dense desktop UI. Pi should stay in this scale:

- Section labels: `text-[10.5px]`, uppercase, `tracking-[0.16em]`
- Metadata: `text-[10px]` to `text-[10.5px]`
- Secondary rows: `text-[11px]` to `text-[11.5px]`
- Main row labels: `text-[12px]`
- Composer body and transcript body: `text-[12px]` with `leading-relaxed` only where reading long text matters

Do not set local font families. Inter comes from the global font setup.

## Spacing and sizes

- Headers use `h-8`, `px-2` or `px-3`, and compact `gap-1` to `gap-2`.
- Rows should be close to Files and Git density: `h-6`, `min-h-10`, or `30px` depending on content.
- Buttons in the sidebar should usually be `h-5`, `h-6`, `size-6`, or `size-7`.
- Use `gap-*`, not `space-x-*` or `space-y-*`.
- Use `size-*` for square affordances.

## Radius and surfaces

- Sidebar rows and small buttons use `rounded-sm` or `rounded-md`.
- Cards use `rounded-lg` when they contain grouped content.
- Use `rounded-full` only for status dots and tiny count bubbles, not for general Pi labels.
- Floating popovers may be larger, but should still use the shared shadcn primitives and semantic colors.

## Icons

- Use Hugeicons only.
- Rail icons are `14px`, stroke `1.75`, active stroke `2`.
- Sidebar row/action icons are normally `11px` to `14px`, stroke `1.75` to `1.9`.
- Empty-state icons should stay close to Git clean state: roughly `16px` inside a `size-8` or `size-9` container.

## States

- Hover states should be quiet: `hover:bg-foreground/[0.04]`, `hover:bg-accent/30`, or existing Button variants.
- Selected/focused rows should match Git and Files: `bg-accent/55`, `bg-accent/60`, or a quiet foreground alpha.
- Keyboard focus must remain visible with `focus-visible:ring-*`.
- Loading and running states use a small muted dot or `Spinner`, not bright custom animations.

## Component rules

Prefer existing primitives:

- Use `Button` for actions.
- Use `Badge` for labels and counts.
- Use `Empty` for empty states.
- Use `Alert` for real error or destructive callouts.
- Use `Textarea` and existing form controls for composer/settings input.
- Use `cn()` for conditional class strings.

Do not hand-roll a primitive when a project primitive already exists unless the component is a dense row that needs custom layout.

## Pi-specific checks

Before shipping Pi frontend changes, verify:

- No raw color classes or raw CSS color values were added.
- No local font, new icon library, or Pi-only visual theme was added.
- All sidebar text stays within the dense `10px` to `12px` scale except long transcript prose.
- Buttons and badges are compact and use semantic variants.
- Empty states mirror Explorer or Source Control sizing.
- Settings changes follow existing Settings section layout, `FieldRow`, `Button`, `Input`, `Switch`, and dropdown patterns.
- Agent and Pi notification surfaces use the same muted status language as the sidebar.
- There are no em dash characters in code, docs, comments, or visible strings.

## Current audit result

The Pi sidebar now follows the Terax sidebar baseline:

- Pi root panel uses `bg-card/80 backdrop-blur` and sidebar borders.
- Runtime, diagnostics, local-agent, context, sessions, transcript, and composer surfaces use semantic tokens and compact sidebar sizing.
- Pi and agent status indicators use muted foreground tokens except destructive error states.
- Pi settings use existing Settings controls and no separate Pi-only palette.
