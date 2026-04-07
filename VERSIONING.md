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

## Conventional commits

Branch prefixes map to version bumps — `fix/` triggers PATCH, `feat/` triggers MINOR. `chore/`, `docs/`, and `refactor/` produce no version change.
