#!/usr/bin/env bash
# Validates release readiness: tag-version match and CHANGELOG stamped.
# Usage: validate-release.sh <version>
# Exit codes: 0 = valid, 1 = validation failure

set -euo pipefail

VERSION="${1:?Usage: validate-release.sh <version>}"

# Validate tag matches package.json
PKG=$(node -p "require('./package.json').version")
if [ "$VERSION" != "$PKG" ]; then
  echo "::error::Tag v$VERSION does not match package.json version $PKG"
  exit 1
fi

# Validate CHANGELOG.md has an entry for this version
if ! grep -qF "## [$VERSION]" CHANGELOG.md; then
  echo "::error::CHANGELOG.md has no entry for [$VERSION]. Run the prepare-release workflow or update CHANGELOG.md manually."
  exit 1
fi
