# Terax Design Language

## 1. Color System

All semantic colors are defined as CSS custom properties in `src/styles/globals.css` using the **oklch()** color space (perceptually-uniform, device-independent). They are declared in a `:root` block for light mode and a `.dark` block for dark mode. Tailwind CSS v4 maps them via a `@theme inline` directive into utility classes.

### 1.1 Base Semantic Colors

#### Light Mode (`:root`)

| Variable | oklch Value | Hue | Tailwind Utility |
|---|---|---|---|
| `--background` | `oklch(1 0 0)` | pure white | `bg-background` |
| `--foreground` | `oklch(0.148 0.004 228.8)` | near-black, slight blue | `text-foreground` |
| `--card` | `oklch(1 0 0)` | pure white | `bg-card` |
| `--card-foreground` | `oklch(0.148 0.004 228.8)` | near-black | `text-card-foreground` |
| `--popover` | `oklch(1 0 0)` | pure white | `bg-popover` |
| `--popover-foreground` | `oklch(0.148 0.004 228.8)` | near-black | `text-popover-foreground` |
| `--primary` | `oklch(0.218 0.008 223.9)` | very dark blue-gray | `bg-primary` |
| `--primary-foreground` | `oklch(0.987 0.002 197.1)` | off-white | `text-primary-foreground` |
| `--secondary` | `oklch(0.963 0.002 197.1)` | very light gray | `bg-secondary` |
| `--secondary-foreground` | `oklch(0.218 0.008 223.9)` | very dark | `text-secondary-foreground` |
| `--muted` | `oklch(0.963 0.002 197.1)` | very light gray | `bg-muted` |
| `--muted-foreground` | `oklch(0.56 0.021 213.5)` | medium gray-blue | `text-muted-foreground` |
| `--accent` | `oklch(0.963 0.002 197.1)` | very light gray | `bg-accent` |
| `--accent-foreground` | `oklch(0.218 0.008 223.9)` | very dark | `text-accent-foreground` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | vivid red | `bg-destructive` |
| `--border` | `oklch(0.925 0.005 214.3)` | very light gray-blue | `border-border` |
| `--input` | `oklch(0.925 0.005 214.3)` | same as border | — |
| `--ring` | `oklch(0.723 0.014 214.4)` | medium gray-blue | `ring-ring` |

#### Dark Mode (`.dark`)

| Variable | oklch Value | Hue |
|---|---|---|
| `--background` | `oklch(0.148 0.004 228.8)` | dark slate |
| `--foreground` | `oklch(0.987 0.002 197.1)` | off-white |
| `--card` | `oklch(0.218 0.008 223.9)` | dark card surface |
| `--card-foreground` | `oklch(0.987 0.002 197.1)` | off-white |
| `--popover` | `oklch(0.218 0.008 223.9)` | dark popover surface |
| `--popover-foreground` | `oklch(0.987 0.002 197.1)` | off-white |
| `--primary` | `oklch(0.925 0.005 214.3)` | light gray |
| `--primary-foreground` | `oklch(0.218 0.008 223.9)` | dark |
| `--secondary` | `oklch(0.275 0.011 216.9)` | dark gray |
| `--secondary-foreground` | `oklch(0.987 0.002 197.1)` | off-white |
| `--muted` | `oklch(0.275 0.011 216.9)` | dark gray |
| `--muted-foreground` | `oklch(0.723 0.014 214.4)` | medium gray |
| `--accent` | `oklch(0.275 0.011 216.9)` | dark gray |
| `--accent-foreground` | `oklch(0.987 0.002 197.1)` | off-white |
| `--destructive` | `oklch(0.704 0.191 22.216)` | desaturated red |
| `--border` | `oklch(1 0 0 / 10%)` | 10% white |
| `--input` | `oklch(1 0 0 / 15%)` | 15% white |
| `--ring` | `oklch(0.56 0.021 213.5)` | medium gray |

### 1.2 Chart Colors (identical in both modes)

| Variable | oklch Value |
|---|---|
| `--chart-1` | `oklch(0.872 0.007 219.6)` |
| `--chart-2` | `oklch(0.56 0.021 213.5)` |
| `--chart-3` | `oklch(0.45 0.017 213.2)` |
| `--chart-4` | `oklch(0.378 0.015 216)` |
| `--chart-5` | `oklch(0.275 0.011 216.9)` |

### 1.3 Sidebar Colors

#### Light (`:root`)
- `--sidebar`: `oklch(0.987 0.002 197.1)` — very light gray
- `--sidebar-foreground`: `oklch(0.148 0.004 228.8)` — near-black
- `--sidebar-primary`: `oklch(0.218 0.008 223.9)` — very dark
- `--sidebar-primary-foreground`: `oklch(0.987 0.002 197.1)` — off-white
- `--sidebar-accent`: `oklch(0.963 0.002 197.1)` — light gray
- `--sidebar-accent-foreground`: `oklch(0.218 0.008 223.9)` — dark
- `--sidebar-border`: `oklch(0.925 0.005 214.3)` — light border
- `--sidebar-ring`: `oklch(0.723 0.014 214.4)` — medium ring

#### Dark (`.dark`)
- `--sidebar`: `oklch(0.218 0.008 223.9)` — dark surface
- `--sidebar-foreground`: `oklch(0.987 0.002 197.1)` — off-white
- `--sidebar-primary`: `oklch(0.488 0.243 264.376)` — vivid indigo-blue
- `--sidebar-primary-foreground`: `oklch(0.987 0.002 197.1)` — off-white
- `--sidebar-accent`: `oklch(0.275 0.011 216.9)` — dark gray
- `--sidebar-accent-foreground`: `oklch(0.987 0.002 197.1)` — off-white
- `--sidebar-border`: `oklch(1 0 0 / 10%)` — 10% white
- `--sidebar-ring`: `oklch(0.56 0.021 213.5)` — medium gray

### 1.4 FOUC Prevention (index.html / settings.html)

A synchronous inline `<script>` reads `localStorage.getItem("terax-ui-theme-shadow")` before first paint. If the stored value is `"light"` or `"dark"`, it applies that class to `<html>` directly. Otherwise it checks `prefers-color-scheme: dark`. It also sets `document.documentElement.style.backgroundColor` to `#0a0a0a` (dark) or `#ffffff` (light) so no white flash occurs on dark mode. The persistent store (tauri-plugin-store `terax-settings.json`) overwrites this on mount.

### 1.5 Syntax Highlight Tokens

Defined in `src/styles/code-highlight.css` as `--tok-*` oklch variables. Used by the Lezer `classHighlighter` for code blocks in AI chat messages.

#### Light (`:root`)

| Token | oklch | Purpose | CSS Classes |
|---|---|---|---|
| `--tok-keyword` | `oklch(0.45 0.15 270)` | keywords, modifiers | `.tok-keyword`, `.tok-modifier`, `.tok-self`, `.tok-controlKeyword`, `.tok-operatorKeyword` |
| `--tok-name` | `oklch(0.32 0.05 250)` | variable/function names | `.tok-variableName`, `.tok-name`, `.tok-function`, `.tok-macroName` |
| `--tok-type` | `oklch(0.55 0.13 200)` | type names, class names | `.tok-typeName`, `.tok-className`, `.tok-namespace` |
| `--tok-property` | `oklch(0.42 0.13 25)` | property names | `.tok-propertyName`, `.tok-definition.tok-propertyName` |
| `--tok-operator` | `oklch(0.55 0.04 250)` | operators | `.tok-operator`, `.tok-derefOperator`, `.tok-arithmeticOperator`, `.tok-logicOperator`, `.tok-bitwiseOperator`, `.tok-compareOperator`, `.tok-updateOperator` |
| `--tok-comment` | `oklch(0.55 0.02 250)` | comments (italic) | `.tok-comment`, `.tok-lineComment`, `.tok-blockComment`, `.tok-docComment` |
| `--tok-string` | `oklch(0.48 0.13 150)` | strings, attribute values | `.tok-string`, `.tok-string2`, `.tok-special.tok-string`, `.tok-character`, `.tok-attributeValue` |
| `--tok-number` | `oklch(0.52 0.14 50)` | numbers | `.tok-number`, `.tok-integer`, `.tok-float` |
| `--tok-bool` | `oklch(0.52 0.15 30)` | booleans, atoms | `.tok-atom`, `.tok-bool` |
| `--tok-regexp` | `oklch(0.5 0.15 0)` | regexps | `.tok-regexp` |
| `--tok-meta` | `oklch(0.5 0.1 290)` | meta, annotations | `.tok-meta`, `.tok-annotation`, `.tok-processingInstruction`, `.tok-special` |
| `--tok-tag` | `oklch(0.45 0.16 25)` | HTML/XML tag names | `.tok-tagName`, `.tok-angleBracket` |
| `--tok-attr` | `oklch(0.5 0.14 70)` | attribute names | `.tok-attributeName` |
| `--tok-punctuation` | `oklch(0.5 0.02 250)` | brackets, parens, separators | `.tok-punctuation`, `.tok-bracket`, `.tok-paren`, `.tok-brace`, `.tok-squareBracket`, `.tok-separator` |
| `--tok-heading` | `oklch(0.42 0.13 25)` | headings (weight 600) | `.tok-heading` through `.tok-heading6` |
| `--tok-link` | `oklch(0.5 0.15 240)` | links, URLs (underline) | `.tok-link`, `.tok-url` |
| `--tok-invalid` | `oklch(0.55 0.22 25)` | invalid (underline wavy) | `.tok-invalid` |

Code style details:
- Comments: `font-style: italic`
- Function names: `font-weight: 500`
- Heading levels 1-6: `font-weight: 600`
- Strong emphasis: `font-weight: 600`
- Regular emphasis: `font-style: italic`
- Links: `text-decoration: underline`
- Invalid tokens: `text-decoration: underline wavy`

#### Dark (`.dark`)

| Token | oklch Value |
|---|---|
| `--tok-keyword` | `oklch(0.78 0.13 305)` |
| `--tok-name` | `oklch(0.92 0.01 250)` |
| `--tok-type` | `oklch(0.83 0.11 200)` |
| `--tok-property` | `oklch(0.82 0.1 25)` |
| `--tok-operator` | `oklch(0.72 0.03 250)` |
| `--tok-comment` | `oklch(0.6 0.02 250)` |
| `--tok-string` | `oklch(0.82 0.12 145)` |
| `--tok-number` | `oklch(0.82 0.13 60)` |
| `--tok-bool` | `oklch(0.82 0.14 30)` |
| `--tok-regexp` | `oklch(0.8 0.14 10)` |
| `--tok-meta` | `oklch(0.78 0.1 290)` |
| `--tok-tag` | `oklch(0.78 0.14 25)` |
| `--tok-attr` | `oklch(0.83 0.12 70)` |
| `--tok-punctuation` | `oklch(0.72 0.02 250)` |
| `--tok-heading` | `oklch(0.82 0.1 25)` |
| `--tok-link` | `oklch(0.78 0.13 240)` |
| `--tok-invalid` | `oklch(0.7 0.22 25)` |

### 1.6 xterm.js ANSI 16 Color Palette

Curated in `src/styles/terminalTheme.ts`. Tuned for the shadcn dark surface — the globals.css semantic layer is intentionally grayscale, so these hex values provide all the chromatic weight.

| ANSI Index | Color Name | Hex | RGB |
|---|---|---|---|
| 0 | black | `#18181b` | rgb(24,24,27) |
| 1 | red | `#ef4444` | rgb(239,68,68) |
| 2 | green | `#22c55e` | rgb(34,197,94) |
| 3 | yellow | `#eab308` | rgb(234,179,8) |
| 4 | blue | `#3b82f6` | rgb(59,130,246) |
| 5 | magenta | `#a855f7` | rgb(168,85,247) |
| 6 | cyan | `#06b6d4` | rgb(6,182,212) |
| 7 | white | `#e4e4e7` | rgb(228,228,231) |
| 8 | brightBlack | `#52525b` | rgb(82,82,91) |
| 9 | brightRed | `#f87171` | rgb(248,113,113) |
| 10 | brightGreen | `#4ade80` | rgb(74,222,128) |
| 11 | brightYellow | `#facc15` | rgb(250,204,21) |
| 12 | brightBlue | `#60a5fa` | rgb(96,165,250) |
| 13 | brightMagenta | `#c084fc` | rgb(192,132,252) |
| 14 | brightCyan | `#22d3ee` | rgb(34,211,238) |
| 15 | brightWhite | `#fafafa` | rgb(250,250,250) |

### 1.7 Syntax Palette (shared between terminal and CodeMirror editor)

```typescript
comment:    "#52525b"  (brightBlack)
keyword:    "#3b82f6"  (blue)
string:     "#22c55e"  (green)
number:     "#eab308"  (yellow)
constant:   "#a855f7"  (magenta)
fn:         "#06b6d4"  (cyan)
type:       "#22d3ee"  (brightCyan)
tag:        "#ef4444"  (red)
punctuation: "#a1a1aa" (zinc-400)
invalid:    "#ef4444"  (red)
link:       "#3b82f6"  (blue)
```

### 1.8 xterm.js Terminal Theme (runtime-built)

The `buildTerminalTheme()` function resolves shadcn CSS tokens from globals.css at runtime (via `readAppTokens()`, which creates a hidden `<div>` probe and reads `getComputedStyle`):

| xterm property | Source |
|---|---|
| `background` | resolved `--background` |
| `foreground` | resolved `--foreground` |
| `cursor` | resolved `--foreground` |
| `cursorAccent` | resolved `--background` |
| `selectionBackground` | resolved `--accent` |
| ANSI 0-15 | the 16 hardcoded hex values above |

### 1.9 Search Inline Colors (xterm addon)

```typescript
matchBackground:           "#515c6a"
activeMatchBackground:     "#d18616"
matchOverviewRuler:        "#d18616"
activeMatchColorOverviewRuler: "#d18616"
```

---

## 2. Typography

### 2.1 Font Families

**UI (sans-serif)**: `'Inter Variable', sans-serif`
- Variable weight font (100–900), loaded via `@fontsource-variable/inter`
- Declared as `--font-sans` and `--font-heading`
- Two unicode-range subsets: Latin (U+0000-00FF + extended) and Cyrillic (U+0400-045F + extended)
- `font-display: swap`

**Monospace (terminal, editor, AI code blocks)**: `"JetBrains Mono", SFMono-Regular, Menlo, monospace`
- Loaded via `@fontsource/jetbrains-mono`, weights 400 and 700
- Nerd Font auto-detection via `document.fonts.check()` — tries these names in order:
  `JetBrainsMono Nerd Font`, `JetBrainsMono Nerd Font Mono`, `JetBrainsMonoNL Nerd Font`,
  `FiraCode Nerd Font`, `FiraCode Nerd Font Mono`, `MesloLGS NF`, `MesloLGM Nerd Font`,
  `Hack Nerd Font`, `Hack Nerd Font Mono`, `CaskaydiaCove Nerd Font`, `CaskaydiaMono Nerd Font`,
  `Iosevka Nerd Font`, `Iosevka Term Nerd Font`, `SauceCodePro Nerd Font`, `Hasklug Nerd Font`
- User-selectable monospace fonts (18 options + auto-detect):
  `JetBrains Mono`, `Fira Code`, `Fira Code Retina`, `Source Code Pro`, `Hack`, `Iosevka`,
  `Iosevka Term`, `MesloLGS NF`, `Cascadia Code`, `Cascadia Mono`, `Inconsolata`,
  `Monaspace Neon/Argon/Xenon/Radon/Krypton`, `SF Mono`, `Menlo`, `monospace`

### 2.2 Font Sizes

| Context | Class / Size |
|---|---|
| Base UI text | `text-sm` (~14px) |
| Body inputs | `text-base` → `md:text-sm` (16px → 14px md+) |
| Dialog titles | `text-lg font-medium` (~18px) |
| Card titles, h3/h4 | `text-base font-medium` (~16px) |
| Empty state title | `text-lg font-medium tracking-tight` |
| Dropdown labels, shortcuts | `text-xs` (~12px) |
| Badge | `text-xs font-medium` |
| Kbd (keyboard key display) | `text-xs font-medium` |
| Tab bar | `text-xs` |
| Input group addon | `text-sm font-medium` |
| Search input | `text-[13px]` |
| Settings tab triggers | `text-[11.5px]` |
| Status bar | `text-[11px]` |
| Agent status pills | `text-[10.5px]` to `text-[11px]` |
| Inline code blocks | `text-[10px]` to `text-[12px]` |
| Tooltip | `text-xs` |
| Terminal font default | `14px` (configurable) |
| Terminal font range | min `5px` – max `238px` |
| Terminal size presets | 10, 12, 13, 14, 15, 16, 18, 20, 22, 24 |

### 2.3 Font Weights

- `font-normal` (400) — body, descriptions, code body
- `font-medium` (500) — buttons, titles, items, labels, active tabs, code function names
- `font-semibold` (600) — code headings, strong emphasis text, empty state titles

---

## 3. Border Radius System

Base radius: `--radius: 0.625rem` (10px). Six derived levels computed via `calc()`:

| Token | Calculation | Value (approx) | Used By |
|---|---|---|---|
| `--radius-sm` | `calc(var(--radius) * 0.6)` | 6px (0.375rem) | Checkbox (`rounded-[5px]`), Kbd (`rounded-lg`) |
| `--radius-md` | `calc(var(--radius) * 0.8)` | 8px (0.5rem) | Skeleton (`rounded-2xl`) |
| `--radius-lg` | `var(--radius)` | 10px (0.625rem) | Scroll bar thumb (`rounded-full`) |
| `--radius-xl` | `calc(var(--radius) * 1.4)` | 14px (0.875rem) | Tooltip (`rounded-xl`), Item media (`rounded-xl`) |
| `--radius-2xl` | `calc(var(--radius) * 1.8)` | 18px (1.125rem) | Textarea, Item, Alert, Select item, Menubar item, Toggle group focus |
| `--radius-3xl` | `calc(var(--radius) * 2.2)` | 22px (1.375rem) | Input, Select trigger, Dropdown content, Popover, HoverCard, Tabs trigger active, Badge, Toggle, Button group text |
| `--radius-4xl` | `calc(var(--radius) * 2.6)` | 26px (1.625rem) | Button, Card, Dialog, AlertDialog, Command, InputGroup |

Explicit overrides:
- Checkbox: `rounded-[5px]`
- Tooltip arrow: `rounded-[2px]`
- Slider thumb: `rounded-full`
- Switch track + thumb: `rounded-full`
- Window chrome (borderless): `border-radius: 12px`
- Alert dialog media: `rounded-full`
- Empty state media icon: `rounded-xl`
- Explorer context menu items: `rounded-xl`
- Explorer context menu content: `rounded-2xl`

---

## 4. Shadows

| Shadow Class | Usage |
|---|---|
| `shadow-sm` | Switch thumb (`shadow-sm ring-0`) |
| `shadow-md` | Card (`shadow-md ring-1 ring-foreground/5`), Slider thumb (`shadow-md ring-1 ring-black/10`) |
| `shadow-lg` | All flyouts: Dialog content, DropdownMenu, Select, Popover, HoverCard, ContextMenu, Menubar, Tooltip. Always paired with `ring-1 ring-foreground/5` (dark: `ring-foreground/10`) |
| `shadow-xl` | Sheet, AlertDialog (`shadow-xl ring-1 ring-foreground/5`, dark: `ring-foreground/10`) |
| `shadow-none` | Button group variants, InputGroup inner controls |

All flyout rings:
- Light: `ring-1 ring-foreground/5`
- Dark: `ring-1 ring-foreground/10`

---

## 5. Z-Index Layers

| Value | Context |
|---|---|
| `z-10` | Resizable handle (grip), Toggle group focus ring, Select scroll buttons |
| `z-40` | AI Mini Window (`fixed right-4 bottom-24`) |
| `z-50` | All overlays + flyouts: Dialog, Sheet, AlertDialog, SelectContent, Popover, HoverCard, DropdownMenu, ContextMenu, Menubar, Tooltip, SelectionAskAi, TooltipArrow, all Radix portal content. Also `inset-0 isolate` with backdrop blur |
| `z-9999` | Loading spinner overlay (in index.html) |

---

## 6. Opacity / Alpha Values

| Value | Usage |
|---|---|
| `0` (hidden, transition) | invisible elements, collapsed tabs |
| `opacity-0` | hover-reveal icons (close button on tabs), exit animations |
| `opacity-50` | disabled states, search icon, muted UI |
| `opacity-60` | inactive tab text |
| `opacity-70` | placeholder text, muted elements |
| `opacity-85` | text-foreground in file tree |
| `opacity-100` | visible, active elements |

Alpha modifiers (background/text/border):
- `bg-black/30` — overlay backdrops
- `bg-background/85` — plan diff review overlay
- `bg-background/90` — conversation scroll-to-bottom button
- `bg-popover/95` — SnippetPicker, FilePicker backgrounds
- `bg-card/95` — SelectionAskAi button backgrounds
- `bg-muted/80` — search input background
- `bg-muted/70` — AI mini window icon container
- `bg-input/50` — input, select, textarea default backgrounds
- `bg-input/90` — checkbox, switch, radio, slider track (unchecked)
- `bg-input/30` — dark mode hover for outline button
- `border-border/60` — sidebar border, header border, settings header separator
- `border-border/70` — dashed borders
- `border-border/50` — separators (dropdown, context, menubar), AI component borders
- `ring-foreground/5` — light mode ring on popovers
- `ring-foreground/10` — dark mode ring on popovers
- `ring-ring/30` — standard focus ring (width 3px)
- `ring-ring/50` — enhanced focus ring on tabs, items, badges
- `ring-destructive/20` — destructive focus ring
- `text-foreground/60` — inactive tab text
- `text-muted-foreground/70` — search placeholder
- `text-destructive/80` — destructive buttons active state

---

## 7. Spacing Scale

Key Tailwind spacing values observed across all components (all values in px at 16px base):

### Padding
- `p-0` — tight containers
- `p-1` (4px) — tight inner padding
- `p-1.5` (6px) — Dropdown/Select/Menubar content padding
- `p-2` (8px) — tab bar tabs
- `p-3` (12px) — Input, Select trigger
- `p-4` (16px) — Popover, HoverCard, Card header
- `p-6` (24px) — Dialog, Sheet, Card body
- `p-12` (48px) — Empty state
- `px-1.5` (6px) — compact items
- `px-2` (8px) — tabs, icons, buttons
- `px-2.5` (10px) — compact context menu items
- `px-3` (12px) — standard items, dropdown items
- `px-3.5` (14px) — item padding (sm)
- `px-4` (16px) — item padding (default), card header
- `px-6` (24px) — wide containers
- `px-8` (32px) — spacer
- `py-0.5` (2px) — file tree items, compact
- `py-1` (4px) — tight vertical
- `py-1.5` (6px) — compact context menu items
- `py-2` (8px) — standard
- `py-2.5` (10px) — item padding (xs)
- `py-3` (12px) — item padding (sm), dropdown
- `py-3.5` (14px) — item padding (default)
- `py-6` (24px) — spacious
- `py-7` (28px) — settings sections
- `py-12` (48px) — empty states, settings

### Height
- `h-4` (16px) — Checkbox, Radio, Switch sm, Slider thumb
- `h-5` (20px) — Badge, Switch default
- `h-5.5` (22px) — Kbd
- `h-6` (24px) — Button xs, icon-xs buttons
- `h-7` (28px) — Button icon-sm, Search, Tab bar items, Header buttons
- `h-8` (32px) — Button sm
- `h-9` (36px) — Button default, Input, Select trigger, Menubar trigger
- `h-10` (40px) — Button lg, Header bar
- `h-11` (44px) — Settings header
- `h-16` (64px) — Textarea minimum height

### Width
- `w-4` (16px) — standard icons
- `w-6` (24px) — Switch thumb (default)
- `w-7` (28px) — Switch thumb (sm)
- `w-11` (44px) — Switch track (default)
- `w-36` (144px) — Select content
- `w-44` (176px) — Dropdown content, Explorer context menu
- `w-48` (192px) — Dropdown, some contexts
- `w-72` (288px) — Popover, HoverCard, SnippetPicker
- `w-80` (320px) — FilePicker

### Max-width
- `max-w-xs` (320px) — AlertDialog content
- `max-w-sm` (384px) — Empty content
- `max-w-md` (448px) — Dialog content at sm breakpoint
- `max-w-160` (640px) — Settings main content area

### Sidebar sizing
- Default: `225px`
- Min: `130px`
- Max: `450px`

### Tab label truncation
- Normal: `max-w-80` (320px)
- Compact: `max-w-48` (192px)

---

## 8. Transitions & Animations

### 8.1 CSS Transition Properties

| Duration | Property | Usage |
|---|---|---|
| `100ms` | `opacity, transform` (via tw-animate-css animate-in/out) | Dialog overlays, popover fade, dropdown, collapsible |
| `100ms` | `color, box-shadow, background-color` | Input, Select, Textarea, InputGroup |
| `100ms` | `colors` | Item, breadcrumb links |
| `180ms` | custom `terax-collapsible-down` keyframe | Collapsible open |
| `160ms` | custom `terax-collapsible-up` keyframe | Collapsible close |
| `200ms` | `transform` with `ease-in-out` | Sheet slide |
| `0.18s` (180ms) | motion `height, opacity` | AI Input Bar panel slide |
| unspecified | `all` | Button, Badge, Switch |
| unspecified | `box-shadow` | Checkbox |
| unspecified | `transform` | Switch thumb, collapsible chevron |
| unspecified | `opacity` | Hover-reveal icons |

### 8.2 Easing Functions

| Easing | Usage |
|---|---|
| `cubic-bezier(0.4, 0, 0.2, 1)` | Custom collapsible open/close (Material standard ease-out) |
| `ease-in-out` | Sheet slide transitions |
| `[0.16, 1, 0.3, 1]` | motion AI Input Bar panel (emphasized ease-out) |
| `"spring" (stiffness: 380, damping: 34)` | motion SearchInline expand/collapse |
| `"linear"` | motion Shimmer text animation (infinite repeat) |

### 8.3 CSS @keyframes

**`terax-collapsible-down`** (180ms):
```
from { height: 0; opacity: 0 }
to   { height: var(--radix-collapsible-content-height); opacity: 1 }
```

**`terax-collapsible-up`** (160ms):
```
from { height: var(--radix-collapsible-content-height); opacity: 1 }
to   { height: 0; opacity: 0 }
```

**Loading spinner** (index.html):
```
@keyframes lspin { to { transform: rotate(360deg); } }
```
Duration: 0.7s, linear infinite.

### 8.4 Radix/tw-animate-css Animate Classes

Standard flyout entry/exit pattern for Dialog, DropdownMenu, Select, Popover, HoverCard, ContextMenu, Menubar, Tooltip:

```
data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95
data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95
```

Slide-in offsets for directional flyouts:
```
data-[side=bottom]:slide-in-from-top-2
data-[side=left]:slide-in-from-right-2
data-[side=right]:slide-in-from-left-2
data-[side=top]:slide-in-from-bottom-2
```

Sheet-specific slide (10 units):
```
data-[side=bottom]:slide-in-from-bottom-10
data-[side=left]:slide-in-from-left-10
data-[side=right]:slide-in-from-right-10
data-[side=top]:slide-in-from-top-10
```

Tooltip additionally uses `data-[state=delayed-open]:animate-in`.

### 8.5 motion (framer-motion) Values

**AiInputBar panel**:
```typescript
animate={{ height: panelOpen ? "auto" : 0, opacity: panelOpen ? 1 : 0 }}
transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
initial={false}
```

**SearchInline expand/collapse**:
```typescript
transition={{ type: "spring", stiffness: 380, damping: 34 }}
```

**SearchInline icon/input crossfade**:
```typescript
transition={{ duration: 0.12 }}
```

**Shimmer text animation**:
```typescript
initial={{ backgroundPosition: "100% center" }}
animate={{ backgroundPosition: "0% center" }}
transition={{ duration: 2, ease: "linear", repeat: Infinity }}
```

### 8.6 motion Layout Components

- `<AnimatePresence>` wraps conditional rendering of `AiMiniWindow` and `SelectionAskAi`
- `motion.div` for collapsible panel transitions
- `motion.create(element)` for dynamic motion component creation (cached at module level)

---

## 9. Focus and Interaction Styles

### Focus Ring System

All interactive elements use `focus-visible` rings. The ring width is consistently `3px`.

| Component | Focus Style |
|---|---|
| Buttons, Inputs, Selects, Textareas, Toggles, Switches, Checkboxes, Radios, Sliders | `focus-visible:ring-3 focus-visible:ring-ring/30` |
| Tabs triggers, Items, Badges | `focus-visible:ring-[3px] focus-visible:ring-ring/50` |
| Scroll area | `focus-visible:ring-[3px] focus-visible:ring-ring/50` |
| Error state (`aria-invalid`) | `focus-visible:ring-3 ring-destructive/20` |
| Dark error state | `focus-visible:ring-3 ring-destructive/40` with `border-destructive/50` |

### Hover States

| Component | Hover Style |
|---|---|
| Button (ghost/outline) | `hover:bg-muted hover:text-foreground` |
| Header icon buttons | `hover:bg-accent hover:text-foreground` |
| Toggle on state | `data-[state=on]:bg-muted` |
| Tab active | `data-[state=active]:bg-background text-foreground` |
| Command selected | `data-[selected]:bg-muted text-foreground` |
| Menu items, Dropdown items | `focus:bg-accent focus:text-accent-foreground` |

### Active / Press States

- Button (non-haspopup): `active:translate-y-px` — subtle press-down
- Destructive button active: `active:bg-destructive/80`
- Outline button active: `active:bg-muted`

### Disabled States

All disabled components follow:
- `opacity-50`
- `pointer-events-none`
- `cursor-not-allowed` (on some)

---

## 10. Icon Library

**Primary**: `@hugeicons/core-free-icons` (React wrapper via `@hugeicons/react`)
**Additional**: `@iconify-json/catppuccin` (for AI provider icons in settings)

Default icon sizing via CSS: `[&_svg:not([class*='size-'])]:size-4` (16px)

Icon sizes used:
- `size-3` (12px) — xs buttons
- `size-3.5` (14px) — small inline
- `size-4` (16px) — standard
- `size-5` (20px) — larger icons
- `size-6` (24px) — explorer header toolbar

Stroke widths:
- `1.75` — dropdown items
- `2` — most UI icons

Icons in active use:

| Icon | Context |
|---|---|
| `Cancel01Icon` | Tab close, Clear, Delete |
| `Tick02Icon` | Check/Confirm |
| `ArrowRight01Icon` | Breadcrumbs |
| `Search01Icon`, `Search02Icon` | Search fields |
| `Settings01Icon` | Settings button |
| `KeyboardIcon` | Shortcuts dialog |
| `SidebarLeftIcon` | Sidebar toggle |
| `GridViewIcon` | Tab grid view |
| `LayoutTwoColumnIcon`, `LayoutTwoRowIcon` | Split pane |
| `MinusSignIcon` | Collapse |
| `Copy01Icon` | Copy action |
| `SquareIcon` | Maxmize window |
| `MoreHorizontalCircle01Icon` | More actions |
| `AiScanIcon` | AI compose |
| `InformationCircleIcon` | Info tooltip |
| `UserMultiple02Icon` | Team/agents |
| `Loading03Icon` | Loading spinner |
| `UnfoldMoreIcon` | Window maximize |
| `ArrowUp01Icon`, `ArrowDown01Icon` | Scroll, Arrow |
| `Folder01Icon` | Explorer empty state |
| `FileAddIcon`, `FolderAddIcon` | Explorer toolbar |
| `Refresh01Icon` | Explorer refresh |
| `ComputerTerminal02Icon` | Terminal tab |
| `IncognitoIcon` | Private terminal tab |
| `Globe02Icon` | SSH terminal tab, preview tab |
| `ServerStack03Icon` | WSL terminal tab |
| `PencilEdit02Icon` | Editor tab |
| `PlusSignIcon` | New tab |
| `GitCompareIcon` | AI diff tab, git diff tab |
| `Clock01Icon` | Git history tab |

---

## 11. CSS Custom Properties — All Variables

### 11.1 Design Tokens

```
--background
--foreground
--card
--card-foreground
--popover
--popover-foreground
--primary
--primary-foreground
--secondary
--secondary-foreground
--muted
--muted-foreground
--accent
--accent-foreground
--destructive
--border
--input
--ring
--radius               (base: 0.625rem)
--chart-1 … --chart-5
--sidebar
--sidebar-foreground
--sidebar-primary
--sidebar-primary-foreground
--sidebar-accent
--sidebar-accent-foreground
--sidebar-border
--sidebar-ring
--font-sans
--font-heading          (= var(--font-sans))
--app-zoom              (default: 1, range 0.5–2.0, step 0.1)
```

### 11.2 Tailwind `@theme inline` Mappings

All `--color-*` variables map 1:1 to their `--*` CSS counterparts. Additionally:

```
--radius-sm   calc(var(--radius) * 0.6)
--radius-md   calc(var(--radius) * 0.8)
--radius-lg   var(--radius)
--radius-xl   calc(var(--radius) * 1.4)
--radius-2xl  calc(var(--radius) * 1.8)
--radius-3xl  calc(var(--radius) * 2.2)
--radius-4xl  calc(var(--radius) * 2.6)
--font-heading  var(--font-sans)
--font-sans     'Inter Variable', sans-serif
```

### 11.3 Radix / shadcn Runtime Variables

Generated by Radix primitives at runtime:
```
--radix-collapsible-content-height
--radix-dropdown-menu-content-available-height
--radix-dropdown-menu-content-transform-origin
--radix-dropdown-menu-trigger-width
--radix-select-content-available-height
--radix-select-content-transform-origin
--radix-select-trigger-height
--radix-select-trigger-width
--radix-popover-content-transform-origin
--radix-tooltip-content-transform-origin
--radix-hover-card-content-transform-origin
--radix-context-menu-content-available-height
--radix-context-menu-content-transform-origin
--radix-menubar-content-transform-origin
```

---

## 12. Gradient Definitions

**Shimmer effect** (AI text, `shimmer.tsx`):
```css
--bg: linear-gradient(90deg, #0000 calc(50% - var(--spread)), var(--color-background), #0000 calc(50% + var(--spread)))
background: var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))
background-size: 250% 100%, auto
background-repeat: no-repeat, padding-box
background-clip: text
-webkit-text-fill-color: transparent
```

**AI Mini Window** (`AiMiniWindow.tsx`):
```css
bg-gradient-to-b from-foreground/[0.03] to-transparent
```

---

## 13. Backdrop Filters

| Filter | Usage |
|---|---|
| `backdrop-blur-sm` (4px) | Dialog, Sheet, AlertDialog overlay (`bg-black/30`) |
| `backdrop-blur-md` (12px) | SelectionAskAi |
| `backdrop-blur-xl` (24px) | SnippetPicker, FilePicker, PlanDiffReview |
| `backdrop-blur` (8px) | Conversation scroll button |

All guarded by `supports-backdrop-filter:`.

---

## 14. Border Styles

| Style | Usage |
|---|---|
| `border-border` | Standard borders (default via `@layer base { * { @apply border-border } }`) |
| `border-border/60` | Sidebar, header, settings header borders |
| `border-border/50` | Dropdown/Context/Menubar separators, AI component borders |
| `border-border/70` | Dashed borders (empty state) |
| `border-transparent` | Default state for inputs, buttons (replaced on focus) |
| `border-dashed` | Empty state |
| `border-input` | Toggle outline variant default border |
| `border-destructive` | Error state borders |
| Separators: `data-[horizontal]:h-px data-[horizontal]:w-full`, `data-[vertical]:w-px data-[vertical]:self-stretch` |

---

## 15. Layout Architecture

### 15.1 App Shell

```
<ThemeProvider>
  <Toaster />                        ← sonner toast notifications (absolute)
  <TooltipProvider>
    <div class="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Header />                     ← h-10, with data-tauri-drag-region
      <main class="zoom-content flex min-h-0 flex-1 flex-col">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel collapsible collapsedSize={0}   ← sidebar
            defaultSize="225px" minSize="130px" maxSize="450px">
            <div class="h-full border-r border-border/60 bg-card">
              <FileExplorer />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="78%">
            <div class="flex h-full min-h-0 flex-col">
              <div class="relative min-h-0 flex-1">
                {terminal, editor, preview, ai-diff stacks
                 (absolute inset-0, hidden via invisible/pointer-events-none)}
              </div>
              {keysLoaded && (
                <motion.div initial={false} animate={{height, opacity}}>
                  <AiInputBar /> or <AiInputBarConnect />
                </motion.div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <StatusBar />                  ← cwd, file path, workspace, AI tools
      <AgentRunBridge />             ← hidden, orchestrates AI diffs
      <AnimatePresence>
        <AiMiniWindow />             ← fixed, z-40
        <SelectionAskAi />           ← positioned absolute at mouse coords
      </AnimatePresence>
      <SessionDialog />
      <ShortcutsDialog />
      <NewEditorDialog />
      <UpdaterDialog />
      <AlertDialog />                ← unsaved changes (close)
      <AlertDialog />                ← unsaved changes (delete)
    </div>
  </TooltipProvider>
</ThemeProvider>
```

### 15.2 Settings Shell

```
<div class="flex h-screen flex-col">
  <header class="h-11 shrink-0 border-b border-border/60">
    <TabsList />                    ← tab navigation
  </header>
  <main class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-160 py-12">
      <active section component />
    </div>
  </main>
</div>
```

### 15.3 Tab System

Tab kinds: `"terminal" | "editor" | "preview" | "ai-diff"` (and `"git-diff"`, `"git-commit-file"`, `"git-history"` per icon definitions).

Content switching uses absolute positioning with visibility toggling:
```html
<div class="relative min-h-0 flex-1">
  <div class="absolute inset-0 px-3 pt-2 pb-2 [.invisible.pointer-events-none when not active]">
    <TerminalStack />
  </div>
  <div class="absolute inset-0 px-3 pt-2 pb-2 [.invisible.pointer-events-none when not active]">
    <EditorStack />
  </div>
  ...
</div>
```

Each visibility layer wraps padding of `px-3 pt-2 pb-2`.

Tab bar layout: horizontal scroll with `overflow-x-auto`, hidden native scrollbars (`[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`), flex `w-max` container. Compact breakpoint at `720px` window width reduces tab padding.

### 15.4 Zoom System

CSS custom property `--app-zoom` on `:root`, controlled via `useZoom()` hook (range 0.5–2.0, step 0.1, default 1.0):

- `.zoom-content { zoom: var(--app-zoom) }` — applied to main content area
- `.zoom-exempt { zoom: calc(1 / var(--app-zoom)) }` — counter-zoom for elements that should stay at 100% (e.g. status bar, toasts)

---

## 16. Window Chrome (Custom Title Bar)

**macOS**: Native traffic lights via Tauri's `TitleBarStyle::Overlay` and `hidden_title(true)`. Header has `pl-20` (80px left padding) to avoid overlap.

**Linux/Windows**: Custom borderless window:
- `<html data-chrome="borderless">` attribute
- `<html>` and `<body>`: `background: transparent !important`
- `#root` / `#settings-root`: `border-radius: 12px`, `border: 1px solid var(--border)`, `background: var(--background)`, `overflow: hidden`
- When snapped (maximized): `data-snapped="true"` → `border-radius: 0`
- Custom `WindowControls` component with min/max/close buttons rendered at the right side
- Header has `data-tauri-drag-region` for window dragging
- `USE_CUSTOM_WINDOW_CONTROLS = !IS_MAC && PLATFORM !== ""`

---

## 17. shadcn/ui Configuration

From `components.json`:
```json
{
  "style": "radix-luma",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/App.css", "baseColor": "mist", "cssVariables": true, "prefix": "" },
  "iconLibrary": "hugeicons",
  "rtl": false,
  "menuColor": "default",
  "menuAccent": "subtle",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

Key config notes:
- **Style**: `radix-luma` — rounded-heavy, pill-shaped components
- **Base color**: `mist` — cool gray-blue tones
- **CSS variables**: enabled
- **RTL**: disabled
- **Icon library**: `hugeicons`

---

## 18. Component Variant Patterns (CVA)

All shadcn components use `class-variance-authority` for variant management:

### Button
- Variants: `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`
- Sizes: `default` (h-9), `xs` (h-6), `sm` (h-8), `lg` (h-10), `icon` (9×9), `icon-xs` (6×6), `icon-sm` (7×7), `icon-lg` (10×10)

### Badge
- Variants: `default`, `secondary`, `destructive`, `outline`, `ghost`, `link`

### Tabs
- Variants: `default` (bg-muted background, pill-shaped), `line` (flat with underline indicator)

### Toggle
- Variants: `default` (bg-transparent), `outline` (border-input)
- Sizes: `default` (h-9), `sm` (h-8), `lg` (h-10)

### Item
- Variants: `default` (border-transparent), `outline` (border-border), `muted` (bg-muted/50)
- Sizes: `default` (px-4 py-3.5), `sm` (px-3.5 py-3), `xs` (px-3 py-2.5)

### Alert
- Variants: `default`, `destructive`

### Card
- Sizes: `default`, `sm` (gap-4 py-4)

### Switch
- Sizes: `default` (h-5 w-11, thumb w-6), `sm` (h-4 w-7, thumb w-7)

### Select Trigger
- Sizes: `default` (h-9), `sm` (h-8)

### Empty
- Media variants: `default`, `icon`

### Item (AI selection)
- Media variants: `default`, `icon`, `image`

---

## 19. Platform Utilities

From `src/lib/platform.ts`:

| Constant | macOS | Linux / Windows |
|---|---|---|
| `IS_MAC` | `true` | `false` |
| `IS_LINUX` | `false` | `"linux"` | `false` |
| `IS_WINDOWS` | `false` | `"windows"` |
| `USE_CUSTOM_WINDOW_CONTROLS` | `false` | `true` (if platform detected) |
| `MOD_KEY` | `"⌘"` | `"Ctrl"` |
| `MOD_PROP` | `"meta"` | `"ctrl"` |
| `CTRL_KEY` | `"⌃"` | `"Ctrl"` |
| `ALT_KEY` | `"⌥"` | `"Alt"` |
| `SHIFT_KEY` | `"⇧"` | `"Shift"` |
| `TAB_KEY` | `"⇥"` | `"Tab"` |
| `ENTER_KEY` | `"↵"` | `"Enter"` |
| `KEY_SEP` | `""` (empty) | `"+"` |

Shortcut formatting: `fmtShortcut("⌘", "K")` → `"⌘K"` (mac) / `"Ctrl+K"` (win/linux).

---

## 20. Theme Provider Architecture

**Location**: `src/modules/theme/ThemeProvider.tsx`

**Theme values**: `"system" | "light" | "dark"`

**Mechanism**:
1. Synchronous fast-path: reads localStorage `terax-ui-theme-shadow` for first paint (prevents FOUC)
2. Async hydration: loads from tauri-plugin-store (`terax-settings.json`) on mount
3. Cross-window sync: listens to Tauri event `terax://prefs-changed` for preference changes from other windows
4. System detection: `matchMedia("(prefers-color-scheme: dark)")` listener
5. Applies `.dark` / `.light` class to `document.documentElement`
6. Persistence: writes to tauri-plugin-store + updates localStorage shadow

**Context API**: `useTheme()` returns `{ theme, resolvedTheme, setTheme }`

---

## 21. Editor Theme Preferences

Nine user-selectable CodeMirror editor themes, stored under key `editorTheme`:
```
atomone, aura, copilot, github-dark, github-light, nord, tokyo-night, xcode-dark, xcode-light
```

---

## 22. Scrollbar Strategy

### Global

All native scrollbars are hidden globally to prevent OS-native chrome clashes and layout flash:
```css
html, html *, html *::before, html *::after {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
html *::-webkit-scrollbar { width: 0; height: 0; display: none; }
```

### Per-Region

Visible scroll affordances are provided only via shadcn `<ScrollArea>` component, which renders styled scrollbar thumbs using:
```css
bg-border, rounded-full
```

### xterm.js

Scrollbars explicitly hidden with `!important`:
```css
.xterm .scrollbar { display: none !important; }
.xterm .xterm-viewport { scrollbar-width: none !important; }
```

### CodeMirror

```css
.cm-editor, .cm-scroller { scrollbar-width: none !important; }
```

### Utility Classes

- `.no-scrollbar { scrollbar-width: none }` (single element)
- `.no-scrollbar-deep { ... }` (element and all children)

---

## 23. Sonner Toast Configuration

Wrapped in `src/components/ui/sonner.tsx`:

- Theme follows resolved theme (`light`/`dark`)
- Toast className: `group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg`
- Description: `group-[.toast]:text-muted-foreground`
- Action button: `group-[.toast]:bg-primary group-[.toast]:text-primary-foreground`
- Cancel button: `group-[.toast]:bg-muted group-[.toast]:text-muted-foreground`
- Position: `top-center` (in App.tsx: `<Toaster closeButton position="top-center" richColors />`)
- Close button enabled, rich colors enabled

---

## 24. Build & Configuration

### Vite Config

- **Plugins**: `react()`, `@tailwindcss/vite`
- **Alias**: `@` → `./src`
- **Build target**: `"chrome120"` (Windows), `"es2022"` (other platforms)
- **Chunk size warning limit**: 1500 kB
- **Multi-entry**: `index.html` (main app), `settings.html` (settings window)
- **Manual chunk splitting**:
  - `ai-anthropic`, `ai-google`, `ai-openai-compat`, `ai-openai`, `ai-cerebras`, `ai-groq`, `ai-xai`, `ai-sdk-shared`
  - `xterm`, `codemirror`, `streamdown`, `motion`, `react`, `radix`
- **Dev server**: port 1420 (strict), HMR port 1421, host configurable via `TAURI_DEV_HOST`
- **Watch ignores**: `src-tauri/**`
- **Production drops**: `debugger` (esbuild.drop), `console.debug`, `console.info`, `console.trace` (esbuild.pure)
- **Clear screen**: disabled

### Tailwind CSS

- **Version**: 4 (no `tailwind.config.js` or `postcss.config.js`)
- **Plugin**: `@tailwindcss/vite` (Vite plugin, not PostCSS)
- **Entry**: `@import "tailwindcss"` in CSS
- **Addons**: `tw-animate-css`, `shadcn/tailwind.css`
- **Dark mode**: custom variant via `@custom-variant dark (&:is(.dark *))`

---

## 25. Loading Screen

Embedded in `index.html` inside `<div id="loading">`:
- Fixed, fullscreen, z-index 9999
- Background: `var(--bg, #090b0c)` (dark slate fallback)
- Spinner: 32×32px, 3px border, 50% radius, top border color `rgba(255,255,255,.6)`, others `rgba(255,255,255,.08)`
- Animation: `lspin 0.7s linear infinite` (360° rotation)
- Message text: positioned 48px from bottom, center, `12px/1.4 system-ui,sans-serif`, `rgba(255,255,255,.25)`
- Removed by App.tsx `useEffect` on mount: `document.getElementById("loading")?.remove()`

---

## 26. UI Pattern Details

### 26.1 Password Input

Native reveal buttons hidden via CSS to avoid doubling with custom eye icon:
```css
input[data-slot="input"][type="password"]::-ms-reveal,
input[data-slot="input"][type="password"]::-ms-clear { display: none; }
input[data-slot="input"][type="password"]::-webkit-reveal-button { display: none; }
```

### 26.2 Slot Attributes

All shadcn components use `data-slot` attributes for selector targeting:
- `data-slot="input"` — input elements
- `data-slot="label"` — label elements
- `data-slot="button"` — button elements
- `data-slot="menu-item"` — menu items
- `data-slot="content"` — content containers
- `data-slot="header"` — card/dialog headers

Plus `data-variant` and `data-size` attributes for variant selectors.

### 26.3 Group-Based Styling

Uses Tailwind's `group/*` pattern:
```html
<div class="group/parent">
  <span class="group-hover/parent:opacity-100">...</span>
</div>
```

### 26.4 Selected Path Highlighting (File Explorer)

Selected file/folder in the explorer:
```css
data-[selected=true]:bg-accent/60 data-[selected=true]:text-accent-foreground
```

### 26.5 Explorer Context Menu Compact Override

File explorer context menu uses denser sizing than the base shadcn context menu:
```
COMPACT_CONTENT = "min-w-44 rounded-2xl p-1"
COMPACT_ITEM    = "rounded-xl px-2.5 py-1.5 text-xs gap-2"
```

### 26.6 Data Attributes for AI/Search Containers

- `data-selection-ask-ai` — marks selection popup for click-outside detection
- `data-ai-input-bar` — marks AI input bar for click-outside detection
- `data-ai-mini-window` — marks AI mini window for click-outside detection

### 26.7 Electron-like File Events

File explorer uses custom DOM events for cross-module communication:
- `terax:ai-attach-file` — dispatched when user clicks "Attach to AI" in explorer context menu

### 26.8 Tab Focus Management

- `data-tab-id` attribute on each tab trigger for scroll-into-view
- `data-fs-path` attribute on file tree nodes for focus/scroll-into-view
- Return focus tracking via `explorerReturnFocusRef`

### 26.9 Mobile Breakpoint

```typescript
const MOBILE_BREAKPOINT = 768;  // px
```

---

## 27. Complete CSS Import Chain

```
globals.css
  ├── @import "tailwindcss"
  ├── @import "tw-animate-css"
  ├── @import "shadcn/tailwind.css"
  ├── @import "./fonts.css"
  │     └── Inter Variable (latin + cyrillic woff2-variations)
  └── @import "./code-highlight.css"
        └── --tok-* variables + tok-* class styles

@source ../../node_modules/streamdown/dist/index.js
  (for Tailwind class scanning in streamdown dependency)
```

---

## 28. Terminal Theme Token Resolution

`readAppTokens()` in `src/styles/tokens.ts`:
- Creates a hidden `<div>` probe (position absolute, visibility hidden, pointer-events none)
- Sets `probe.style.color = 'var(--${name})'` for each token
- Reads `getComputedStyle(probe).color` to get the resolved RGB string
- Tokens resolved: `background`, `foreground`, `card`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `border`, `primary`, `destructive`, `ring`

---

## 29. Data Attributes & Custom Events Summary

| Attribute / Event | Element / Purpose |
|---|---|
| `data-tauri-drag-region` | Header (window drag) |
| `data-chrome="borderless"` | `<html>` (custom window chrome) |
| `data-snapped="true"` | `<html>` (maximized window) |
| `data-slot="..."` | All shadcn component parts |
| `data-variant="..."` | Variant selection |
| `data-size="..."` | Size selection |
| `data-state="open\|closed"` | Radix state |
| `data-state="active\|inactive"` | Tab state |
| `data-state="on\|off"` | Toggle state |
| `data-side="top\|bottom\|left\|right"` | Flyout alignment |
| `data-selected` | Command/List selected item |
| `data-[horizontal\|vertical]` | Separator orientation |
| `data-[hasPopup]` | Button with popup |
| `data-tab-id` | Tab trigger element |
| `data-fs-path` | File tree node |
| `data-selection-ask-ai` | Selection popup container |
| `data-ai-input-bar` | AI input bar container |
| `data-ai-mini-window` | AI mini window container |
| `terax:ai-attach-file` | Custom event (file → AI) |
| `terax://prefs-changed` | Tauri event (cross-window pref sync) |
| `terax:settings-tab` | Tauri event (settings tab navigation) |
| `terax-ui-theme-shadow` | localStorage key (theme fast-path) |

---

## 30. Directory Layout for Styles

```
src/styles/
├── globals.css             ← Tailwind v4 entry, theme tokens, CSS variables, keyframes,
│                              custom chrome, scrollbar hiding, xterm/cm overrides
├── tokens.ts               ← Runtime CSS token → RGB resolver (for xterm/CodeMirror)
├── fonts.css               ← Inter Variable @font-face declarations
├── fonts.ts                ← Nerd Font detection, monospace font family list
├── terminalTheme.ts        ← ANSI 16 palette, syntax palette, buildTerminalTheme()
├── code-highlight.css      ← tok-* syntax highlighting variables and classes
└── tokens.ts               ← AppTokens type, readAppTokens()
```
