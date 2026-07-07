# Updater key rotation smoke report

Use this report before publishing the release that ships updater key `52D6B9847A3B8F15`. It captures the fresh-install and pre-rotation update evidence that the local agent cannot produce without maintainer signing secrets, release-workflow access, and installable signed artifacts.

Do not paste private key values, passwords, release tokens, or unredacted feed URLs containing credentials. Record key ids, artifact ids, release ids, and masked secret status only.

## Run metadata

| Field | Value |
| --- | --- |
| Tester |  |
| Date |  |
| PR / branch | `#964` / `pi-sidebar` |
| Commit tested |  |
| Release or test-feed URL |  |
| Platform(s) tested |  |
| New key id | `52D6B9847A3B8F15` |
| Old key id | `3BABFD8AB60E3469` |
| Migration choice | Transition release / Reinstall announcement |
| Notes, logs, or screen recording link |  |

## Preconditions

- Confirm repository Actions secrets contain the new-key values for `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Confirm the old private key is either retired because it is unsafe/unavailable, or deliberately available only for the chosen transition-release hop.
- Produce a signed release or signed test feed with the release workflow.
- Run `pnpm run inspect:updater-feed -- <feed-url-or-latest.json> --expect-key 52D6B9847A3B8F15` and attach the output.
- If testing a transition release, also inspect the old-key transition feed with `--expect-key 3BABFD8AB60E3469` and record which artifact installs the new-key app.

## 1. New install accepts the new-key feed

| Check | Result |
| --- | --- |
| Install a build that embeds updater key `52D6B9847A3B8F15`. | Pending |
| Point it at the signed release or signed test feed. | Pending |
| Trigger an update check from the app. | Pending |
| Update applies successfully. | Pending |
| Relaunched app still embeds/trusts `52D6B9847A3B8F15`. | Pending |
| Feed inspector passes with `--expect-key 52D6B9847A3B8F15`. | Pending |

Evidence:

```bash
pnpm run inspect:updater-feed -- <feed-url-or-latest.json> --expect-key 52D6B9847A3B8F15
```

- Artifact tested:
- App version before update:
- App version after update:
- Inspector output link or pasted redacted output:
- Screenshot or note:

## 2. Pre-rotation install rejects a new-key-only feed

This proves existing old-key clients cannot silently accept a release signed only by the rotated key.

| Check | Result |
| --- | --- |
| Install the last public old-key build that embeds `3BABFD8AB60E3469`. | Pending |
| Point it at a feed signed only by `52D6B9847A3B8F15`. | Pending |
| Trigger an update check from the app. | Pending |
| Update is rejected or not offered because the signature cannot verify. | Pending |
| No partial update is applied. | Pending |

Evidence:

- Old build/version tested:
- New-key-only feed tested:
- Observed rejection text/log:
- Screenshot or note:

## 3. Chosen existing-install migration path works

Pick exactly one path and record evidence.

### Transition release path

| Check | Result |
| --- | --- |
| Confirm old private key is trusted and available only for this transition hop. | Pending |
| Publish or stage an old-key signed transition feed. | Pending |
| `pnpm run inspect:updater-feed -- <transition-feed> --expect-key 3BABFD8AB60E3469` passes. | Pending |
| Install the last public old-key build. | Pending |
| Trigger update through the transition feed. | Pending |
| Update applies and relaunches into the app build that embeds `52D6B9847A3B8F15`. | Pending |
| A follow-up update check against a new-key feed succeeds. | Pending |

Evidence:

- Transition feed:
- Transition artifact:
- Old app version before transition:
- App version after transition:
- Inspector output link or pasted redacted output:
- Screenshot or note:

### Reinstall announcement path

| Check | Result |
| --- | --- |
| Confirm old private key is unavailable, unsafe, or intentionally retired. | Pending |
| Confirm release notes use the reinstall-announcement wording from `docs/updater-key-rotation.md`. | Pending |
| Install the new-key release manually over or beside an old install. | Pending |
| App launches and reports the expected version. | Pending |
| Follow-up update check against a new-key feed succeeds. | Pending |

Evidence:

- Release note link:
- Manual installer artifact:
- App version after reinstall:
- Screenshot or note:

## 4. Final release-note and secret hygiene

| Check | Result |
| --- | --- |
| Actual release notes include exactly one migration path. | Pending |
| No release notes include private key material, signing password, or secret names beyond public variable names. | Pending |
| Old key is retired or access-scoped according to the chosen migration path. | Pending |
| `docs/updater-key-rotation.md` status is updated after verification. | Pending |
| `docs/pi-sidebar-release-readiness.md` updater row is updated after verification. | Pending |

Evidence:

- Release note URL:
- Secret review note:
- Follow-up issue, if any:

## Final decision

| Item | Result |
| --- | --- |
| New install update path verified | Pending |
| Pre-rotation rejection behavior verified | Pending |
| Existing-install migration path verified | Pending |
| Feed inspector evidence attached | Pending |
| Maintainer sign-off |  |

Summary:

- Pass or fail:
- Blocking issues:
- Non-blocking follow-ups:
