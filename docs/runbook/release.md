# Release Runbook

## Policy

- Package publishing is automated with Changesets + GitHub Actions.
- Changelog maintenance is semi-automatic:
  - humans write one short changeset note per release-worthy change
  - Changesets versions packages and updates changelogs automatically
- Do not derive release notes only from commit messages.

## Local maintainer flow

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

## Required secrets

- `NPM_TOKEN`

## Notes

- Publishable package: `agent-remnote`
- `@remnote/plugin` stays private and is ignored by Changesets for npm publishing.
