# Release Runbook

## Policy

- Package publishing is automated with Changesets + GitHub Actions Trusted Publishing (OIDC).
- Changelog maintenance is semi-automatic:
  - humans write one short changeset note per release-worthy change
  - Changesets versions packages and updates changelogs automatically
- Do not derive release notes only from commit messages.

## Local maintainer flow

Trusted Publishing note:

- npm Trusted Publishing currently requires npm CLI `11.5.1+` and Node `22.14.0+`
- This repo pins the release workflow to Node 22 and upgrades npm before publishing


1. Add a changeset:

```bash
npm run changeset
```

2. Inspect pending release plan:

```bash
npm run release:check
```

3. Merge changes to `master`.

4. Release workflow will either:
   - open/update a version PR, or
   - publish to npm when the version PR is merged

## Required GitHub / npm setup

- npm package `agent-remnote` must have a Trusted Publisher configured for `yoyooyooo/agent-remnote`
- Workflow filename on npm must match `.github/workflows/release.yml` exactly
- No `NPM_TOKEN` is required for publishing once Trusted Publishing is enabled

## Notes

- Publishable package: `agent-remnote`
- `@remnote/plugin` stays private and is ignored by Changesets for npm publishing.
