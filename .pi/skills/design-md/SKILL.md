---
name: design-md
description: Create or update DESIGN.md files for AI-readable design systems, design tokens, component metadata, Storybook references, and agent UI guardrails. Use when the user asks for design.md, agentic design systems, AI-safe design documentation, or design-system instructions for coding agents.
---

# DESIGN.md

Use this skill to create or update a repo-level `DESIGN.md` file that helps agents build UI with the product's real tokens, components, states, and constraints.

Full reference guide from this skill directory: `../../../docs/design-md-guide.md`

## When not to use

Do not use this skill for repos with no UI layer unless the user explicitly wants a design system scaffold. Do not treat `DESIGN.md` as a replacement for Figma, Storybook, token packages, or component docs. It is the map that points agents to those sources.

## Output standard

A strong `DESIGN.md` contains:

- YAML front matter with exact tokens.
- Product-specific prose that explains design intent.
- The standard sections in the correct order.
- Component summaries with deep references to source, Storybook, docs, or metadata.
- Practical do and don't rules based on real failure modes.
- Accessibility constraints.
- Agent memory instructions so future UI work reads `DESIGN.md` first.

Standard section order:

1. `## Overview`
2. `## Colors`
3. `## Typography`
4. `## Layout`
5. `## Elevation & Depth`
6. `## Shapes`
7. `## Components`
8. `## Do's and Don'ts`

Optional sections such as Motion, Iconography, Data Visualization, Accessibility, Themes and Modes, and Implementation Sources may be added when relevant.

## Source of truth priority

When sources conflict, prefer this order:

1. Current implemented UI and canonical screenshots.
2. Token files, CSS variables, Tailwind theme, and theme providers.
3. Component source, variants, tests, Storybook, and docs.
4. Existing product or brand docs.
5. User-provided intent for a new design-system change.

Document current truth. Mark future intent clearly instead of mixing it into current rules.

## Workflow

### 1. Confirm scope

Ask only if ambiguous. Determine whether to:

- Create a new `DESIGN.md`.
- Update an existing `DESIGN.md`.
- Add component metadata references.
- Add or update agent memory rules.
- Add validation or CI.

If the user asks for full setup, do all of them.

### 2. Inventory design sources

Search for design evidence:

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

Inspect app shell, screenshots, theme providers, CSS variables, component variants, icon usage, motion usage, accessibility helpers, and docs.

### 3. Extract and normalize tokens

Extract colors, typography, spacing, radii, borders, shadows, motion, breakpoints, component variants, and icon rules. Map raw values to semantic roles such as `background`, `surface`, `text`, `text-muted`, `border`, `accent`, `danger`, `success`, and `focus-ring`.

For Tailwind or CSS-variable projects, document both the semantic token and the implementation source. Do not invent a parallel token system if one already exists.

### 4. Write product intent

Write a concrete overview that answers:

- What is the product?
- Who uses it?
- What does the UI optimize for?
- What should it feel like?
- What should it never feel like?

Specific references beat vague adjectives. Avoid relying on words like "modern", "clean", or "premium" unless the prose explains exactly what they mean here.

### 5. Write front matter

Use YAML front matter with these core groups:

- `colors`
- `typography`
- `spacing`
- `rounded`
- `components`

Rules:

- Keep `version: alpha` unless the official DESIGN.md spec changes.
- Prefer `#RRGGBB` color values.
- Use semantic token names.
- Use `{path.to.token}` references.
- Use unitless `lineHeight` when possible.
- Use `px`, `rem`, or `em` for dimensions.

### 6. Write prose sections

Each section should connect values to behavior. Explain scarcity, hierarchy, density, accessibility, and forbidden uses.

Bad:

```markdown
The app uses blue and gray and should look modern.
```

Good:

```markdown
Blue is reserved for active focus, selected navigation, and the primary action in setup flows. Gray surfaces create small tonal steps for long-running work. Do not use blue as decoration or as a chart default.
```

### 7. Add component deep references

In `## Components`, summarize only the system-level rule. Link to deeper references when they exist:

```markdown
### Button

Use `Button` for actions that execute an operation. For navigation, use the navigation link component instead. Primary buttons are limited to one per focused task region.

Deep references:
- Source: `src/components/ui/button.tsx`
- Stories: `src/components/ui/button.stories.tsx`
- Metadata: `src/components/ui/button.metadata.ts`
```

If metadata does not exist yet, do not pretend it does. Either link to source and Storybook only, or create small metadata files for the most important components when the user requested full setup.

### 8. Update agent memory

Update the root agent memory file used by the repo, such as root `AGENTS.md`, `CLAUDE.md`, `TERAX.md`, or the documented project equivalent. Do not update nested package memory files unless the user asks or that package has its own UI design system.

Add this rule:

```markdown
When creating or modifying UI, first read `DESIGN.md`. Follow its tokens, prose, and guardrails. If a component entry includes a metadata, Storybook, or source reference, open that reference before implementing the component. Reuse existing tokens and components. Do not invent new colors, spacing, radii, motion, icons, or variants unless the user explicitly asks for a design-system change.
```

### 9. Validate

Use the repo's package manager. For pnpm projects:

```bash
pnpm dlx @google/design.md lint DESIGN.md
```

If the package is added as a dev dependency:

```bash
pnpm exec designmd lint DESIGN.md
```

If the CLI is unavailable, still manually check YAML parsing, token references, section order, duplicate headings, component reference paths, and WCAG AA contrast where relevant.

### 10. Final quality gate

Before reporting done, verify:

- The file describes the actual product, not a generic design system.
- The front matter is valid YAML.
- Standard sections are present and ordered.
- Token names are semantic and values are exact.
- Prose explains why, not only what.
- Component references point to real files or are clearly marked as planned.
- Do and don't rules prevent realistic AI mistakes.
- Accessibility and reduced-motion expectations are covered.
- Agent memory tells future agents to read `DESIGN.md` before UI work.

## Maintenance triggers

Update `DESIGN.md` when a theme token changes, a component variant changes, a repeated AI mistake appears, Storybook or metadata paths move, or a new product surface becomes canonical. Keep implementation details in component docs or metadata and link to them from `DESIGN.md`.

## References

- Full local guide: `../../../docs/design-md-guide.md`
- Google Labs `design.md`: `https://github.com/google-labs-code/design.md`
- Google Labs spec: `https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md`
- Design Tokens Community Group format: `https://www.designtokens.org/tr/2025.10/format/`
- Storybook AI best practices: `https://storybook.js.org/docs/ai/best-practices.md`
