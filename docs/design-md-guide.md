# DESIGN.md guide and skill playbook

This guide explains how to create, maintain, and use a `DESIGN.md` file as an AI-readable design system contract. It pairs with the project-local `design-md` pi skill.

`DESIGN.md` should give coding agents enough product design context to build UI that matches the existing brand, components, states, and constraints without inventing new design decisions.

## What DESIGN.md is

`DESIGN.md` is a plain Markdown file with two layers:

1. YAML front matter at the top, containing machine-readable design tokens.
2. Markdown prose, containing human-readable design intent, usage rules, and guardrails.

The token values are the normative values. The prose explains why those values exist and how to apply them.

Use `DESIGN.md` as the repo-level design map. It should point agents to deeper sources of truth, not duplicate every design system detail.

## Core principles

1. Prose carries design intent.
   - Specific references beat generic adjectives.
   - Bad: "modern, clean, premium".
   - Good: "dense technical terminal UI with calm matte surfaces, low-glare contrast, and sharp utility-first controls".

2. Tokens give exact values.
   - Colors, type, spacing, radii, and component token references should be explicit.
   - Prefer stable semantic names like `surface`, `on-surface`, `accent`, `border-subtle`, and `danger`.

3. The file is a map, not an encyclopedia.
   - Keep `DESIGN.md` high level.
   - Link to component metadata, Storybook stories, Figma references, theme files, and token files for depth.

4. Current product behavior wins.
   - Document what the product actually uses now.
   - Mark aspirational changes clearly as future work, not current rules.

5. Negative constraints matter.
   - Say what must never happen.
   - This prevents agents from adding generic gradients, shadows, colors, rounded corners, icons, or motion.

6. Accessibility is part of the design system.
   - Include contrast, focus, keyboard, reduced-motion, hit-target, and error-state expectations.

7. It must be lintable and reviewable.
   - Keep section order consistent.
   - Validate with the official `@google/design.md` CLI when available.
   - Review changes to `DESIGN.md` like product behavior changes.

## Canonical location

Place the file at the repository root:

```text
DESIGN.md
```

For larger products, keep the root file as the entry point and link to deeper docs:

```text
DESIGN.md
docs/design/components.md
docs/design/motion.md
src/components/button/metadata.ts
src/components/input/metadata.ts
.storybook/
```

Agents should first read `DESIGN.md`, then follow references only when the current task needs them.

## When not to create one

Do not create a detailed `DESIGN.md` for a repo with no UI layer unless the user explicitly wants a scaffold. Do not use it as a replacement for Figma, Storybook, token packages, or component docs. It is the map that points agents to those sources.

## Source of truth priority

When sources conflict, prefer this order:

1. Current implemented UI and canonical screenshots.
2. Token files, CSS variables, Tailwind theme, and theme providers.
3. Component source, variants, tests, Storybook, and docs.
4. Existing product or brand docs.
5. User-provided intent for a new design-system change.

Document current truth. Mark future intent clearly instead of mixing it into current rules.

## Required shape

The standard section order is:

1. `## Overview`
2. `## Colors`
3. `## Typography`
4. `## Layout`
5. `## Elevation & Depth`
6. `## Shapes`
7. `## Components`
8. `## Do's and Don'ts`

Optional sections can be added after the standard sections or inside the closest standard section:

- Motion
- Iconography
- Data Visualization
- Content Style
- Accessibility
- Themes and Modes
- Implementation Sources
- Component Deep References

Avoid duplicate section headings. Consumers should preserve unknown sections, but duplicate standard sections can break validation.

## YAML front matter

The front matter starts and ends with `---` and appears at the top of the file.

Recommended schema:

```yaml
---
version: alpha
name: Product Name
description: One-sentence product description and design posture.
colors:
  background: "#0B0D10"
  surface: "#11151B"
  surface-raised: "#171D25"
  text: "#E8EDF2"
  text-muted: "#99A3AF"
  border: "#26303A"
  accent: "#7C9CFF"
  accent-hover: "#9AAFFF"
  danger: "#FF6B6B"
typography:
  display-sm:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0em
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  panel: 20px
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  full: 9999px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    typography: "{typography.body-md}"
    padding: 12px
  input-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    typography: "{typography.body-md}"
---
```

### Front matter rules

- Use `version: alpha` until the spec changes.
- Use one product or brand name in `name`.
- Keep token names lowercase and predictable.
- Prefer `#RRGGBB` hex values for compatibility.
- Use semantic color names for UI roles.
- Use brand color names in prose if they help, but keep token names functional.
- Use unitless `lineHeight` for typography when possible.
- Use `px`, `rem`, or `em` for dimensions.
- Use `{path.to.token}` references instead of duplicating values.
- Keep core groups valid: `colors`, `typography`, `spacing`, `rounded`, and `components`.
- Put experimental groups in prose or a clearly named custom group only if your tooling preserves unknown keys.

## Token guidance

### Colors

Include both palette and semantic roles.

Minimum useful set:

```yaml
colors:
  background: "#0B0D10"
  surface: "#11151B"
  surface-raised: "#171D25"
  text: "#E8EDF2"
  text-muted: "#99A3AF"
  border: "#26303A"
  accent: "#7C9CFF"
  danger: "#FF6B6B"
```

For production systems, add:

- `success`, `warning`, `info`, `danger`
- `on-accent`, `on-danger`, `on-surface`
- `focus-ring`
- `selection`
- `overlay`
- `chart-1` through `chart-n`
- theme variants like `surface-dark`, `surface-light`, or a documented mode strategy

In prose, explain scarcity and priority:

- Which color is the main action color.
- Which colors are only for status.
- Which colors are forbidden for decoration.
- Whether neutral surfaces should be warm, cool, high contrast, or low glare.

### Typography

Most real systems need 9 to 15 levels.

Recommended semantic levels:

```yaml
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: -0.03em
  display-sm:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em
  heading-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.02em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0em
```

In prose, explain:

- Which font family is used for UI.
- Which font family is used for code, metrics, terminal output, or data.
- Maximum number of weights per region.
- Whether headings can use negative tracking.
- Whether uppercase labels are allowed.
- How dense the interface should feel.

### Spacing and layout

Define the base rhythm.

Common patterns:

- 4px micro-grid for dense tools.
- 8px grid for general product UI.
- 12px or 16px component internals for calm dashboards.
- 24px or 32px page gutters for marketing surfaces.

Document:

- Page max width.
- Panel widths.
- Sidebar widths.
- Header and footer heights.
- Mobile breakpoint behavior.
- Density rules.
- Empty-state spacing.

### Elevation and depth

Depth can be expressed by:

- Shadows.
- Borders.
- Tonal layering.
- Blur and glass.
- Z-index and overlays.
- Inset highlights.

Be explicit. If the product is flat, say so.

Good guidance:

```markdown
Depth is conveyed through tonal layers and hairline borders, not heavy shadows. Panels may sit one tonal step above the app background. Floating popovers may use a subtle shadow, but core panes must remain visually anchored.
```

### Shapes

Define the shape language:

- Sharp and utilitarian.
- Soft but not playful.
- Pill-shaped interactive chips.
- Fully square terminal panes.
- Radius scale by component size.

Avoid allowing agents to mix unrelated radius styles.

### Motion

Motion is not in the core schema, but it is critical for agentic UI work. Add a `## Motion` section or include it under `## Components`.

Document:

- Duration tiers.
- Easing curves.
- Which components animate.
- Which components never animate.
- Loading and skeleton behavior.
- Reduced-motion behavior.

Example:

```markdown
## Motion

Motion is functional and short. Hover and press feedback should complete within 120ms. Panels and command menus may animate over 160ms to 220ms using a standard ease-out curve. Do not use bounce, elastic, overshoot, particle, or decorative animation. Respect `prefers-reduced-motion` by removing nonessential transitions.
```

### Iconography

Document:

- Icon library.
- Stroke weight.
- Filled vs outline style.
- Default sizes.
- Label pairing rules.
- When icons are forbidden.

Example:

```markdown
## Iconography

Use Hugeicons outline icons for product chrome. Default size is 16px in dense controls and 20px in empty states. Icons should support recognition, not decoration. Do not mix icon libraries in the same surface.
```

### Data visualization

If the product includes charts, include:

- Chart palette.
- Axis and grid styling.
- Tooltip styling.
- Empty and loading states.
- Color-blind safe constraints.
- Maximum number of series before changing visualization.

## Markdown body expectations

The Markdown body should explain how to use the tokens and components in real product work. Keep it concrete, current, and linked to deeper sources. Use the complete starter template at the end of this guide when creating a new file.

## Section writing guide

### Overview

The overview should answer:

- What is the product?
- Who uses it?
- What should it feel like?
- What existing object or design tradition is the strongest reference?
- What should it never feel like?

Good overview:

```markdown
Product Name is a focused product for a specific audience doing a specific job. The UI should feel fast, quiet, dense, and precise. It should avoid marketing-site decoration, heavy gradients, cartoon motion, and generic SaaS dashboard styling.
```

### Colors

The colors section should connect tokens to intent.

Include:

- Main palette.
- Surface hierarchy.
- Text hierarchy.
- Interaction colors.
- Status colors.
- Selection and focus.
- Theme mode rules.
- Contrast rules.

Example:

```markdown
## Colors

The palette is low-glare and dark-first. Backgrounds should stay near black but not pure black. Surfaces move in small tonal steps so panels remain readable during long terminal sessions. Accent blue is reserved for primary actions, active focus, and selected navigation. It must not be used as generic decoration.

- `background` is the app canvas.
- `surface` is the default panel and input surface.
- `surface-raised` is used for floating menus and active panes.
- `text` is for primary content.
- `text-muted` is for metadata, placeholders, and secondary labels.
- `accent` is scarce and indicates the user's current path or primary action.
```

### Typography

Include:

- Family and fallback.
- Scale.
- Weight rules.
- Code or terminal rules.
- Labels and metadata.
- Line length for prose.

Example:

```markdown
## Typography

Use Inter for application chrome and JetBrains Mono for terminal, code, command output, and technical metadata. Typography should be compact and legible, not expressive. Avoid large marketing headings inside the app shell. Use at most two font weights in a single dense region.
```

### Layout

Include:

- Base spacing scale.
- Component padding.
- View layout.
- Responsive behavior.
- Split panes and resizable panels.
- Density modes if any.

Example:

```markdown
## Layout

The layout uses a dense 4px rhythm with 8px and 12px as the most common control gaps. Primary surfaces are split panes, sidebars, terminal stacks, editors, and popovers. Preserve information density. Do not introduce oversized dashboard cards unless the route is explicitly an overview screen.
```

### Components

The components section should not restate every prop. It should point to the full contract.

For each important component, include:

- Component name.
- Purpose.
- Source path.
- Storybook path if available.
- Metadata path if available.
- Variants.
- States.
- Anti-patterns.

Recommended entry:

```markdown
### Button

Use `Button` for actions that mutate state or trigger an operation. For navigation, use the navigation link component instead. Primary buttons are limited to one per focused task region.

Deep references:
- Source: `src/components/ui/button.tsx`
- Stories: `src/components/ui/button.stories.tsx`
- Metadata: `src/components/ui/button.metadata.ts`

Before creating or modifying a button, open the metadata file and follow its variants, size rules, states, and anti-patterns.
```

## Component metadata

For mature AI workflows, each important component should have a metadata file that acts as the full machine-readable contract.

Suggested path options:

```text
src/components/ui/button.metadata.ts
src/components/button/metadata.ts
docs/design/components/button.md
```

Suggested TypeScript shape:

```ts
export const buttonMetadata = {
  name: "Button",
  source: "src/components/ui/button.tsx",
  stories: "src/components/ui/button.stories.tsx",
  summary: "Use Button for actions that execute an operation without navigating.",
  useWhen: [
    "Submitting a form",
    "Starting a task",
    "Confirming an operation"
  ],
  doNotUseWhen: [
    "Navigating to another route",
    "Displaying a passive status",
    "Showing more than one primary action in the same task region"
  ],
  variants: {
    primary: "Use for the single strongest action in a task region.",
    secondary: "Use for safe alternatives and supporting actions.",
    ghost: "Use inside dense chrome when the container already provides structure.",
    danger: "Use only for destructive actions after clear labeling."
  },
  sizes: {
    sm: "Dense chrome and compact toolbars.",
    md: "Default forms and panels.",
    lg: "Empty states or setup flows."
  },
  states: [
    "default",
    "hover",
    "active",
    "focus-visible",
    "disabled",
    "loading"
  ],
  accessibility: [
    "Every icon-only button must have an accessible label.",
    "Focus-visible state must be clearly visible against the current surface.",
    "Loading state must prevent duplicate submissions."
  ],
  antiPatterns: [
    "Do not place two primary buttons next to each other.",
    "Do not use danger styling for non-destructive actions.",
    "Do not use Button for route navigation."
  ]
} as const;
```

A metadata file should be compact, explicit, and maintained next to the component it describes.

If metadata files do not exist yet, do not invent references. Link to source and Storybook only, or create small metadata files for the highest-risk components when the user requested full setup.

## Storybook and AI-ready component docs

If Storybook is present, make it the component evidence layer.

Best practices:

- Each story should demonstrate one concept or use case.
- Story names should be descriptive.
- Add JSDoc summaries to components and props.
- Add story descriptions that explain why the story exists.
- Do not pack every size and variant into one confusing story.
- Exclude deprecated or instructional-only stories from AI manifests if the tooling supports it.
- Keep MDX docs explicit. Agents cannot reliably infer values hidden behind dynamic rendering.

A good story explains the rule:

```ts
/**
 * Primary buttons are used for the main action in a task region.
 * Use only one primary button per region.
 *
 * @summary main action in a task region
 */
export const Primary = {
  args: { variant: "primary" }
};
```

## Agent memory integration

Add this rule to `AGENTS.md`, `CLAUDE.md`, or the repo's equivalent agent memory file:

```markdown
When creating or modifying UI, first read `DESIGN.md`. Follow its tokens, prose, and guardrails. If a component entry includes a metadata, Storybook, or source reference, open that reference before implementing the component. Reuse existing tokens and components. Do not invent new colors, spacing, radii, motion, icons, or variants unless the user explicitly asks for a design-system change.
```

For projects with multiple agents, add the same instruction to every root agent file that the team uses.

## Creation workflow for an agent skill

A skill that creates or updates `DESIGN.md` should follow this workflow.

### Step 1: Confirm scope

Ask only if the scope is ambiguous:

- Create a new `DESIGN.md` from the current repo.
- Update an existing `DESIGN.md`.
- Create component metadata references.
- Add agent memory rules.
- Add CI validation.

If the user asks for a full setup, do all of the above.

### Step 2: Inventory sources

Search for:

```text
components.json
tailwind.config.*
postcss.config.*
src/**/*.css
src/**/*.scss
src/**/*.tsx
src/**/theme*
src/**/tokens*
src/**/components/**
.storybook/**
*.stories.tsx
*.stories.mdx
figma
brand
design system
```

Also inspect:

- Existing screenshots.
- Marketing pages.
- App shell components.
- Theme provider files.
- CSS variables.
- shadcn configuration.
- Icon library usage.
- Motion library usage.
- Accessibility helpers.

### Step 3: Extract tokens

Extract:

- Color values and CSS variables.
- Typography families, sizes, weights, line heights, and tracking.
- Spacing scale.
- Radius scale.
- Shadows, borders, and elevation.
- Motion durations and easing.
- Breakpoints and layout widths.
- Component variants.
- Icon sizes and stroke styles.

Normalize duplicates and map raw values to semantic roles. For Tailwind or CSS-variable projects, document both the semantic token and the implementation source. Do not invent a parallel token system if one already exists.

### Step 4: Derive the design intent

Read the product README, docs, screenshots, and app shell. Write a specific design reference.

Answer:

- What is the product category?
- What does the UI optimize for?
- What should users feel?
- What should agents avoid?
- Which existing screens are canonical examples?

### Step 5: Write front matter

Include the core token groups:

- `colors`
- `typography`
- `spacing`
- `rounded`
- `components`

Keep custom groups minimal unless the project needs them.

### Step 6: Write prose sections

For each section, connect tokens to product behavior.

Bad:

```markdown
The app uses blue and gray and should look modern.
```

Good:

```markdown
Blue is reserved for active focus, selected navigation, and the primary action in setup flows. Gray surfaces should create small tonal steps for long-running work. Do not use blue as decoration or as a chart default.
```

### Step 7: Add component deep references

For every core component, add references to its source and metadata.

Start with:

- Button
- Input
- Textarea
- Select
- Dialog
- Dropdown menu
- Tooltip
- Tabs
- Sidebar item
- Command palette
- Toast
- Data table
- Empty state
- Navigation link

Use existing project names instead of generic names when possible.

### Step 8: Update agent memory

Update `AGENTS.md`, `CLAUDE.md`, or equivalent root memory files with the rule from the Agent memory integration section.

### Step 9: Validate

Use the repo's package manager. For pnpm projects, one-off validation is:

```bash
pnpm dlx @google/design.md lint DESIGN.md
```

If the package is added as a dev dependency:

```bash
pnpm exec designmd lint DESIGN.md
```

If the CLI is unavailable, still manually check:

- YAML parses correctly.
- Token references resolve.
- Color contrast passes WCAG AA where relevant.
- Standard sections are in order.
- No duplicate headings exist.
- Component references point to real files.

### Step 10: Smoke test with an agent

Ask an agent to design a small UI change using the new file.

Good smoke test prompts:

```text
Using DESIGN.md, add an empty state for the project list.
```

```text
Using DESIGN.md and the Button metadata, create a destructive confirmation dialog.
```

Review whether the result:

- Reuses tokens.
- Reuses components.
- Avoids forbidden patterns.
- Opens metadata before implementation.
- Produces fewer invented values.

## Maintenance workflow

Update `DESIGN.md` when:

- A theme token changes.
- A component variant is added or removed.
- A design rule changes.
- A repeated AI mistake is observed.
- Storybook docs or component metadata move.
- A new product surface becomes canonical.

Do not update `DESIGN.md` for every small component implementation detail. Put details in component metadata and link them.

Recommended review checklist:

- Is the change current truth or future intent?
- Does the prose explain why?
- Are exact token values present?
- Are component links still valid?
- Did lint pass?
- Did any agent memory files need updates?

## Versioning and governance

Keep `version: alpha` unless the official DESIGN.md spec changes. Track product design changes through normal code review. Treat updates to tokens, component rules, or do and don't constraints as product behavior changes, not casual documentation edits. If a future spec version appears, update the version only after checking the official migration guidance.

## Anti-patterns

Avoid these common failures:

1. Token dump with no prose.
   - Agents know values but not design intent.

2. Vague prose with no exact values.
   - Agents understand mood but invent implementation.

3. Duplicating the full component library in `DESIGN.md`.
   - The file becomes stale and too long.

4. Using brand names for every token.
   - Agents need semantic roles more than internal naming lore.

5. No negative constraints.
   - Agents add generic UI patterns that do not belong.

6. No agent memory rule.
   - The file exists but agents do not read it.

7. No component deep references.
   - Agents see that a component exists but miss variant, state, and accessibility rules.

8. No validation.
   - Broken token references silently reduce usefulness.

9. Treating it as designer-only documentation.
   - The file must be useful for designers, engineers, PMs, and agents.

## Quality checklist

A strong `DESIGN.md` has:

- Valid YAML front matter.
- A product-specific overview.
- Exact color tokens.
- Exact typography tokens.
- A clear spacing and layout system.
- Radius and shape rules.
- Elevation or depth rules.
- Motion guidance if the product has UI animation.
- Iconography guidance if the product uses icons.
- Component summaries with deep references.
- Do and don't rules that match real failure modes.
- Accessibility constraints.
- Agent memory integration.
- Lint or CI validation.
- No stale references.

## CI recommendation

If the project accepts a dev dependency, add:

```bash
pnpm add -D @google/design.md
```

Then add a package script:

```json
{
  "scripts": {
    "design:lint": "designmd lint DESIGN.md"
  }
}
```

Run:

```bash
pnpm run design:lint
```

For teams with visual regression testing, pair this with Storybook tests, accessibility checks, and screenshot review.

## Complete starter template

```markdown
---
version: alpha
name: Product Name
description: One-sentence description of the product and its design posture.
colors:
  background: "#0B0D10"
  surface: "#11151B"
  surface-raised: "#171D25"
  text: "#E8EDF2"
  text-muted: "#99A3AF"
  border: "#26303A"
  accent: "#7C9CFF"
  accent-hover: "#9AAFFF"
  danger: "#FF6B6B"
typography:
  display-sm:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em
  heading-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.02em
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  full: 9999px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    typography: "{typography.body-md}"
    padding: 12px
---

# Product Name Design System

## Overview

Describe the product, audience, design reference, density, and emotional tone. Be specific. State what the UI should never become.

## Colors

Explain semantic color roles, scarcity, contrast, status colors, focus, selection, and theme behavior.

## Typography

Explain font usage, hierarchy, weights, code or data typography, labels, and maximum complexity per region.

## Layout

Explain grid, spacing rhythm, page structure, panels, breakpoints, and density rules.

## Elevation & Depth

Explain shadows, borders, tonal layers, overlays, and hierarchy.

## Shapes

Explain corner radius, pills, square regions, borders, and component-specific shape rules.

## Components

This section is the system-level summary. It intentionally does not restate every component contract. Before building, composing, or modifying a component, open its referenced metadata or Storybook file.

### Button

Use for actions that execute an operation. Do not use for route navigation.

Deep references:
- Source: `src/components/ui/button.tsx`
- Stories: `src/components/ui/button.stories.tsx`
- Metadata: `src/components/ui/button.metadata.ts`

## Do's and Don'ts

- Do reuse existing tokens and components.
- Do preserve the product's density and hierarchy.
- Do keep focus states visible.
- Don't introduce new hues without a design-system change.
- Don't mix component variants outside their documented purpose.
- Don't use decorative motion where functional feedback is enough.
```

## References

- Google Labs `design.md` repository: `https://github.com/google-labs-code/design.md`
- Google Labs `DESIGN.md` spec: `https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md`
- Google Labs `DESIGN.md` philosophy: `https://github.com/google-labs-code/design.md/blob/main/PHILOSOPHY.md`
- Design Tokens Community Group format: `https://www.designtokens.org/tr/2025.10/format/`
- Storybook AI best practices: `https://storybook.js.org/docs/ai/best-practices.md`
- Storybook AI manifests: `https://storybook.js.org/docs/ai/manifests.md`
