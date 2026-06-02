TERAX.md

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **terax-ai** (6808 symbols, 13757 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/terax-ai/context` | Codebase overview, check index freshness |
| `gitnexus://repo/terax-ai/clusters` | All functional areas |
| `gitnexus://repo/terax-ai/processes` | All execution flows |
| `gitnexus://repo/terax-ai/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Ui area (203 symbols) | `.claude/skills/generated/ui/SKILL.md` |
| Work in the Components area (161 symbols) | `.claude/skills/generated/components/SKILL.md` |
| Work in the App area (136 symbols) | `.claude/skills/generated/app/SKILL.md` |
| Work in the Git area (104 symbols) | `.claude/skills/generated/git/SKILL.md` |
| Work in the Modules area (90 symbols) | `.claude/skills/generated/modules/SKILL.md` |
| Work in the Pty area (90 symbols) | `.claude/skills/generated/pty/SKILL.md` |
| Work in the Ai-elements area (80 symbols) | `.claude/skills/generated/ai-elements/SKILL.md` |
| Work in the Settings area (74 symbols) | `.claude/skills/generated/settings/SKILL.md` |
| Work in the Tests area (62 symbols) | `.claude/skills/generated/tests/SKILL.md` |
| Work in the Source-control area (58 symbols) | `.claude/skills/generated/source-control/SKILL.md` |
| Work in the Sections area (57 symbols) | `.claude/skills/generated/sections/SKILL.md` |
| Work in the Store area (53 symbols) | `.claude/skills/generated/store/SKILL.md` |
| Work in the Theme area (52 symbols) | `.claude/skills/generated/theme/SKILL.md` |
| Work in the Tools area (41 symbols) | `.claude/skills/generated/tools/SKILL.md` |
| Work in the Shell area (39 symbols) | `.claude/skills/generated/shell/SKILL.md` |
| Work in the Editor area (38 symbols) | `.claude/skills/generated/editor/SKILL.md` |
| Work in the Workspace area (34 symbols) | `.claude/skills/generated/workspace/SKILL.md` |
| Work in the Fs area (34 symbols) | `.claude/skills/generated/fs/SKILL.md` |
| Work in the Git-history area (34 symbols) | `.claude/skills/generated/git-history/SKILL.md` |
| Work in the Autocomplete area (34 symbols) | `.claude/skills/generated/autocomplete/SKILL.md` |

<!-- gitnexus:end -->
