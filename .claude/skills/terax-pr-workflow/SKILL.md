---
name: terax-pr-workflow
description: Use this skill whenever making ANY change to this repository — features, fixes, shortcuts, refactors, anything. It enforces the mandatory branch → commit → dual-PR (fork + upstream) → merge-fork → back-to-main workflow. Trigger on phrases like "create a PR", "add a feature", "fix this", "push this", "open a pull request", or any task that involves committing and shipping code changes.
user-invocable: true
---

# Terax PR Workflow

Every change to this repo MUST follow this exact workflow. No exceptions.

## Remotes

- `origin` → `https://github.com/roberto-fernandino/terax-ai-fork.git` (the fork — you have write access)
- `upstream` → `https://github.com/crynta/terax-ai.git` (the original — NO push access, use cross-fork PRs)

## Step-by-step

### 1. Create a branch

```bash
git checkout main
git pull origin main
git checkout -b feat/<descriptive-name>
# or fix/<name>, chore/<name>, etc.
```

Branch name must be kebab-case and describe the change.

### 2. Make the changes

Implement the feature/fix. Type-check before committing:

```bash
npx tsc --noEmit
```

### 3. Commit

Stage only the relevant files (never `git add -A` blindly):

```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
feat/fix/chore(scope): short imperative description

Longer explanation if needed.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

### 4. Push to fork

```bash
git push origin <branch-name>
```

### 5. Check for existing open PRs — BEFORE creating new ones

**This step is mandatory.** Before opening any PR, check whether one already exists for the same feature area:

```bash
gh pr list --repo roberto-fernandino/terax-ai-fork --state open
gh pr list --repo crynta/terax-ai --author roberto-fernandino --state open
```

- If an open PR exists for the same feature/area → push commits to that branch and update the existing PR. Do NOT create a new one.
- Only create a new PR if no related open PR exists.

Related means: same feature, same subsystem, or a fix that belongs to an in-progress feature branch. When in doubt, add to the existing PR.

### 6. Create PR on the fork (roberto-fernandino/terax-ai-fork)

Only if no existing open PR covers this change:

```bash
gh pr create \
  --repo roberto-fernandino/terax-ai-fork \
  --base main \
  --head <branch-name> \
  --title "<same as commit title>" \
  --body "$(cat <<'EOF'
## Summary
- bullet points

## Test plan
- [ ] item

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 7. Create cross-fork PR on the upstream (crynta/terax-ai)

Only if no existing open upstream PR covers this change. Push access is denied to upstream, so use the fork branch as head:

```bash
gh pr create \
  --repo crynta/terax-ai \
  --base main \
  --head roberto-fernandino:<branch-name> \
  --title "<same as commit title>" \
  --body "..."
```

### 8. Merge the fork PR

```bash
gh pr merge <pr-number> --repo roberto-fernandino/terax-ai-fork --merge --auto
```

### 9. Return to main and pull

```bash
git checkout main
git pull origin main
```

## Rules

- ALWAYS create a branch — never commit directly to main.
- ALWAYS check for existing open PRs before creating new ones (step 5). Push to the existing branch/PR when the change belongs to the same feature or subsystem.
- ALWAYS open TWO PRs when creating new ones: one on the fork, one on the upstream (cross-fork).
- ALWAYS merge the fork PR and return to main at the end.
- NEVER push directly to upstream (no access); always use `--head roberto-fernandino:<branch>` for the upstream PR.
- NEVER open a new PR for a fix that belongs to an existing open feature PR — add the commit to that branch instead.
- Type-check (`npx tsc --noEmit`) before committing.
- Use conventional commit prefixes: `feat`, `fix`, `chore`, `refactor`, `docs`.
