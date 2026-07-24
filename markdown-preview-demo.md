---
name: markdown-preview-demo
description: >-
  A quick tour of everything the markdown preview handles: headings, alerts,
  lists, tables, task lists, code, footnotes, anchors, local images and
  inline HTML.
metadata:
  type: demo
  version: 2.0
tags:
  - preview
  - rendering
---

# Markdown preview demo

This file exercises the features a typical README or skill file uses. Open it
side by side with GitHub's rendering to compare; everything here is plain
GitHub-flavored markdown, so the file stays valid there too.

## Contents

These links are the same anchors GitHub generates, and they scroll the
preview pane in place:

- [Text basics](#text-basics)
- [Alerts](#alerts)
- [Lists](#lists)
- [Tables](#tables)
- [Code](#code)
- [Images and local files](#images-and-local-files)
- [Inline HTML](#inline-html)
- [What's in a slug?](#whats-in-a-slug)
- [Live refresh](#live-refresh)

## Text basics

Regular paragraph with **bold**, *italic*, `inline code`, a
[link](https://example.com), ~~strikethrough~~, and a footnote reference.[^1]

> A blockquote spanning a couple of lines, because quoting other people's
> documentation is half of technical writing.

[^1]: Footnotes are part of GitHub-flavored markdown too.

## Alerts

All five GitHub alert types render with their icons and hues, in light and
dark themes:

> [!NOTE]
> Useful information that users should know, even when skimming.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.

Alerts follow GitHub's rules exactly. An unknown type stays a plain
blockquote:

> [!DANGER]
> There is no DANGER alert type, so this renders as the literal text.

So does a marker with content on the same line:

> [!TIP] An inline marker like this one is not an alert on GitHub either.

## Lists

Bullet lists, nested two spaces deep:

- Terminal
- Editor
  - Markdown preview
  - Syntax highlighting
- Explorer

Numbered lists, where nested items align under the parent's *text* (three
spaces):

1. Gather requirements
2. Build the thing
   1. Prototype
   2. Simplify
   3. Verify
3. Ship it

Task lists:

- [x] Render frontmatter as a table
- [x] Fix list markers
- [ ] Bask in glory

## Tables

A standard pipe table sizes to its content, exactly like GitHub:

| Feature     | Markdown source   | Renders as    |
| ----------- | ----------------- | ------------- |
| Frontmatter | `---` YAML block  | Table         |
| Task list   | `- [x] done`      | Checkboxes    |
| Code fence  | ` ```ts `         | Highlighted   |

Layout control stays in markdown: a directive comment above the table
(invisible on GitHub, which just renders the plain table). Full width,
columns still sized by content:

<!-- table width="100%" -->
| Left | Right |
|------|-------|
| Fills the page width | however small the content is |

Equal columns at the table's natural width; width and cols are independent:

<!-- table cols="equal" -->
| Q1 | Q2 | Q3 | Q4 |
|----|----|----|----|
| 25% | 25% | 25% | 25% |

Both together, full width and equal:

<!-- table width="100%" cols="equal" -->
| North | South | East | West |
|-------|-------|------|------|
| a | b | c | d |

Custom columns, fixed widths where you want them, `auto` shares the rest:

<!-- table width="100%" cols="12%, auto, 25%" -->
| ID (12%) | Description (auto) | Owner (25%) |
|----|-------------|-------|
| 7 | The auto middle column absorbs whatever space the fixed ones leave behind. | terax |

(Raw HTML tables with `<colgroup>` work too; the directive just writes that
markup for you.)

## Code

```ts
export function greet(name: string): string {
  // Highlighting comes from the app's own renderer.
  return `Hello, ${name}!`;
}
```

Shell fences get the command treatment:

```bash
corepack enable pnpm
pnpm install
```

Plain fences with no language tag must keep their layout too; ASCII diagrams
live and die by whitespace:

```
workspace          top-level folder: settings + docs
  └─ src           application code: ui, services, storage
      └─ tests     unit + integration, run on every push
```

## Images and local files

A relative path resolves against this file's directory, like GitHub resolves
it against the repo:

![Terax app icon](src-tauri/icons/128x128.png)

The dot-slash form works the same way:

![Terax app icon again, smaller](./src-tauri/icons/64x64.png)

A missing file degrades to the browser's standard broken-image state, no
errors, exactly like GitHub:

![This image intentionally does not exist](assets/does-not-exist.png)

One deliberate difference: a bare relative *link* such as [the
roadmap](ROADMAP.md) renders as plain text here, because the preview cannot
navigate between files yet and a dead link would be worse. The dot-slash form
[./ROADMAP.md](./ROADMAP.md) stays an anchor. On GitHub both navigate.

## Inline HTML

<div align="center">
  <h3>A centered HTML block</h3>
  <p>Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to do something impressive.</p>
</div>

<details>
<summary>Click to expand</summary>

Hidden content works too, handy for long changelogs. H<sub>2</sub>O and
E = mc<sup>2</sup> for good measure.

</details>

## What's in a slug?

Heading anchors match GitHub's slugger: this section's id is
`whats-in-a-slug`, punctuation stripped, spaces hyphenated. Duplicate
headings get numeric suffixes:

### Twin heading

The first twin keeps the bare slug.

### Twin heading

The second becomes `twin-heading-1`:
[jump to the second twin](#twin-heading-1).

## Live refresh

Edit this file in another editor, or let an agent rewrite it, and the
preview re-reads on save while keeping your scroll position. Nothing to
screenshot here; try it live.

---

That horizontal rule above is the last feature. The end.
