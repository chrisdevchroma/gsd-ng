# Versioning & Release Strategy

gsd-ng implements semantic versioning with a two-tier npm dist-tag system.

## Core structure

Follows [Semantic Versioning 2.0.0](https://semver.org/): patches for bug fixes, minors for enhancements, majors for breaking changes. Two npm dist-tags manage distribution: `latest` for stable releases and `dev` for pre-releases.

## Version progression

**Minor releases** progress through dev phases before stabilizing:

```
1.1.0-dev.1 → 1.1.0-dev.2 → 1.1.0
```

**Major releases** use an extended dev cycle to signal broader testing:

```
2.0.0-dev.1 → 2.0.0-dev.2 → 2.0.0-dev.3 → 2.0.0
```

## Branch strategy

Feature and fix work targets `develop` via prefixed branches (`feat/`, `fix/`, `chore/`). When a release is ready, `develop` is merged to `main` and a version tag is pushed. Hotfixes targeting a stable release go directly to `main` via `hotfix/X.Y.Z` branches.

## Release workflows

**Patch releases** cherry-pick critical fixes to main via hotfix branches and publish immediately to `latest`.

**Minor and major releases** are staged: one or more `-dev.N` versions are published to `dev` for validation, then a stable tag is pushed to publish to `latest`.

### Triggering a release

Releases can be triggered two ways:

1. **Dispatch workflow** (or use the Actions tab):
   - Pre-release from develop: `gh workflow run prepare-release.yml -f version=X.Y.Z-dev.N -f branch=develop`
   - Stable release from main: `gh workflow run prepare-release.yml -f version=X.Y.Z -f branch=main`

   This validates the version, bumps `package.json`, commits, tags, and pushes — then the release and publish workflows trigger automatically.

2. **Manual:** Bump `package.json`, commit, push a `v<version>` tag. The `release.yml` and `publish.yml` workflows trigger on the tag push and validate that the tag matches `package.json`.

## CI guardrails

- **Tag-version validation:** Both `release.yml` and `publish.yml` verify the pushed tag matches the version in `package.json`. A mismatch fails the workflow before any publish occurs.
- **CHANGELOG enforcement:** PRs to `main` that don't update `CHANGELOG.md` fail CI; PRs to other branches receive a non-blocking warning.
- **Release approval:** Publishing to npm requires a reviewer to approve the `release` environment in GitHub.

## Conventional commits

Branch prefixes (`fix/`, `feat/`, `chore/`) and squash-merge commit messages categorize changes but do not drive automated version bumps. Version numbers are a deliberate human decision at release time, following gitflow conventions.
