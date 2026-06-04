# Pi frontend design contract

Pi must feel like a native Terax surface, not an imported Howcode UI.

## Source of truth
- Reuse the existing Terax design language from:
  - `src/styles/globals.css` and `src/styles/fonts.css`
  - `src/components/ui/*`
  - `src/components/ai-elements/*`
  - `src/modules/sidebar/SidebarRail.tsx`
  - `src/modules/source-control/SourceControlPanel.tsx`
  - `src/modules/explorer/*`
  - `src/modules/ai/components/*`
- Do not introduce a Pi-specific palette, font stack, icon set, spacing system, or panel chrome.

## Visual rules
- Use semantic Tailwind tokens only: `bg-card`, `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted`, `text-destructive`, etc.
- Keep the dense desktop scale used by Terax panels: mostly `text-[10px]` through `text-[12.5px]`, compact `h-5`/`h-6`/`h-7` controls, `gap-1` through `gap-2.5`, and `px-2`/`px-3` panel padding.
- Use Inter through the global font setup; never set a local font family in Pi UI.
- Use Hugeicons only (`@hugeicons/core-free-icons` + `@hugeicons/react`). Typical panel icons are 12 to 14px with stroke widths around 1.75 to 1.9; active rail icons may use stroke width 2.
- Match existing panel chrome: `bg-card/80 backdrop-blur`, subtle borders like `border-border/40` to `border-border/60`, muted cards like `bg-background/95` or `bg-card/60`, and rounded `md`/`lg`/`2xl` according to nearby Terax surfaces.
- Prefer subtle foreground-alpha hovers (`hover:bg-foreground/[0.04]`) or existing Button variants over saturated custom states.

## Component rules
- Prefer existing primitives before custom markup: `Button`, `Badge`, `Empty`, `Alert`, `Spinner`, `Tooltip`, `Separator`, `Textarea`, and AI message/conversation primitives where appropriate.
- Use `cn()` for conditional classes.
- Use `flex` + `gap-*`; avoid `space-x-*`/`space-y-*`.
- Use `size-*` for square affordances.
- Keep selectable transcript text explicitly `select-text`, because global UI is otherwise non-selectable.
- Do not add raw scrollbars or custom scrollbar styling; follow existing overflow patterns.

## Pi-specific application
- The Pi sidebar header should mirror Source Control/File Explorer density and hierarchy.
- Session lists should look like Terax list rows/tree rows: compact height, subtle selected state, tiny status dot, muted secondary metadata.
- Transcript rendering should follow `src/components/ai-elements/message.tsx`: user messages as muted rounded bubbles, assistant output as full-width readable text, errors as destructive callouts, system/runtime events as compact muted rows.
- The composer should follow `AiInputBar` and Source Control textarea patterns: compact top border, transparent/card background, `text-[12px]` to `text-[13px]`, `leading-relaxed`/`leading-snug`, existing `Button` sizes.
- Context preview chips/cards must be non-secret, compact, truncating, and token-based; no bright provider-brand colors.
- Provider/settings UI must live with existing Settings → Models patterns and keyring infrastructure, not a separate Pi-only settings visual system.
- Diagnostics should be actionable but quiet: compact status rows, `Badge` for counts/modes, `Alert` only for real errors or missing required setup.
