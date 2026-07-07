# Updater signing-key rotation (2026-07)

The Tauri updater public key in `src-tauri/tauri.conf.json` was rotated:

| | minisign public key fingerprint |
|---|---|
| Old | `3BABFD8AB60E3469` |
| New | `52D6B9847A3B8F15` |

Update feed: `https://github.com/crynta/terax-ai/releases/latest/download/latest.json`.

This is intentional. This document is the cutover checklist and the migration
hazard it creates.

## Why this is delicate

The updater pubkey is **baked into each installed app at build time**. On update
check, a client downloads `latest.json` plus the release signature and validates
that signature against **its own embedded pubkey**. Therefore:

- A release signed with the **new** private key validates only on builds that
  embed the **new** pubkey (this build and everything shipped after it).
- Every **already-installed** client still embeds the **old** pubkey. It will
  **reject** a release signed only with the new key, so its in-app auto-update
  silently stops working. Those users must reinstall manually (or be migrated by
  a transition release; see below).

So rotating the key is safe going forward but strands the existing install base
unless handled deliberately.

## Cutover checklist (must all be true before publishing the next release)

1. **Private key in CI.** The minisign secret matching `52D6B9847A3B8F15` is set
   as the release signing secret (`TAURI_SIGNING_PRIVATE_KEY` +
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) in the release workflow's secrets.
   Confirm the new key signs and the old secret is removed/retired.
2. **Old private key retired/secured.** If the rotation is due to suspected
   compromise, revoke the old key everywhere and never sign with it again.
3. **Release signature verifies against the new pubkey** locally before publish
   (`minisign -V` against `52D6B9847A3B8F15`).
4. **Existing-install migration decided** (pick one, document the choice in the
   release notes):
   - *Accept the break*: announce that users on builds <= the last old-key
     release must reinstall once; or
   - *Transition release*: ship one more build signed with the **old** key whose
     payload is the new-key build, so old clients accept the update and land on
     the new pubkey. (Tauri does not support dual-signing one artifact, so this
     is a staged hop, not a single release.)
5. **Release notes** state the key rotation and the user action (if any).

## Verification

- New installs: install this build, trigger an update check against a test feed
  signed with the new key, confirm it applies.
- Old installs: install a pre-rotation build, point it at a feed signed with the
  new key, confirm it **rejects** (proves the threat model) and that the chosen
  migration path (reinstall or transition release) works.

## Release-notes draft

Use exactly one of these notes for the release that ships the rotated updater
key, after the maintainer chooses the migration path.

### Preferred transition-release path

> This release rotates Terax's updater signing key. Existing installations can
> update normally through the in-app updater because this transition release was
> signed with the previous trusted key and installs a build that trusts the new
> key. Future updates will be signed with the new key.

### Fallback reinstall-announcement path

> This release rotates Terax's updater signing key. Existing installations built
> before this release cannot verify the new update signature through the in-app
> updater. If your app does not update automatically, download and install the
> latest Terax release manually once; future updates will work normally from the
> new signing key.

## Status

- [x] Pubkey rotated in `tauri.conf.json` to `52D6B9847A3B8F15`.
- [x] Local config audit confirms the embedded updater pubkey decodes to `untrusted comment: minisign public key: 52D6B9847A3B8F15`.
- [x] Release workflow wiring audit confirms the current `.github/workflows/release.yml` passes `secrets.TAURI_SIGNING_PRIVATE_KEY` and `secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD` into `tauri-apps/tauri-action@v0`. There is no separate AppImage re-sign step in the current workflow; if one is added later, re-audit that it receives the same new-key secrets.
- [x] Live feed audit confirms the current public `v0.8.2` `latest.json` exists and all embedded platform signatures carry old key id `3BABFD8AB60E3469`, while this branch embeds new pubkey `52D6B9847A3B8F15`. This means a build from this branch cannot validate the current public latest feed until a new-key signed release or test feed exists.
- [x] Migration recommendation chosen: prefer a **transition release** if the old private key is still trusted/available, because it preserves auto-update for existing installs. If the rotation was caused by suspected compromise or the old key is unavailable, fall back to the reinstall announcement path.
- [ ] New private key value verified in release CI secrets (`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). The current agent cannot verify or set repository secrets: `gh secret list --repo crynta/terax-ai --app actions` returned HTTP 403 again on 2026-07-07.
- [ ] Transition-release feasibility confirmed by a maintainer with access to the old updater private key and release workflow secrets.
- [x] Release-note draft prepared for both migration outcomes above.
- [ ] Existing-install migration path noted in the actual release notes for the release that ships this change.
- [ ] End-to-end update verified on a new install and an old install against a signed test feed.

## Current blocker

The remaining updater-key-rotation work requires maintainer-held signing secrets and release-workflow access. The local agent can build unsigned app/updater artifacts for size checks, confirm the workflow references the expected secret names, and inspect the public feed. The current public feed is still signed with the old key, so it is useful evidence for the pre-rotation state but cannot prove fresh new-key updater acceptance. Fresh/pre-rotation acceptance still needs a signed release or test feed produced by the configured CI secrets and, for the recommended transition path, the old signing key.
