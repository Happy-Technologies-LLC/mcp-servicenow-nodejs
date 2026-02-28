#!/usr/bin/env bash
set -euo pipefail

# Release script for servicenow-mcp-server
# Publishes to: GitHub (tag + release), npm, Docker Hub
# Usage:
#   ./scripts/release.sh          # publish current version from package.json
#   ./scripts/release.sh 2.2.0    # bump to 2.2.0, commit, then publish

DOCKER_USER="nczitzer"
DOCKER_IMAGE="mcp-servicenow-nodejs"
REPO="Happy-Technologies-LLC/mcp-servicenow-nodejs"

cd "$(git rev-parse --show-toplevel)"

# --- Version resolution ---
if [ -n "${1:-}" ]; then
  echo "==> Bumping version to $1"
  npm version "$1" --no-git-tag-version
  git add package.json package-lock.json
  git commit -m "Release v$1"
  git push origin main
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

echo ""
echo "=========================================="
echo "  Releasing servicenow-mcp-server ${TAG}"
echo "=========================================="
echo ""

# --- Preflight checks ---
echo "==> Preflight checks"

if ! npm whoami &>/dev/null; then
  echo "ERROR: Not logged in to npm. Run: npm login"
  exit 1
fi

if ! docker info &>/dev/null; then
  echo "ERROR: Docker is not running."
  exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Uncommitted changes. Commit or stash first."
  exit 1
fi

# Check we're on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "WARNING: On branch '$BRANCH', not 'main'. Continue? (y/N)"
  read -r ans
  [ "$ans" = "y" ] || exit 1
fi

# --- 1. GitHub: Tag + Release ---
echo ""
echo "==> [1/4] GitHub tag & release"
if git rev-parse "$TAG" &>/dev/null; then
  echo "  Tag $TAG already exists, skipping tag creation"
else
  git tag -a "$TAG" -m "Release $TAG"
  git push origin "$TAG"
  echo "  Pushed tag $TAG"
fi

if gh release view "$TAG" &>/dev/null; then
  echo "  GitHub release $TAG already exists, skipping"
else
  gh release create "$TAG" \
    --title "Release $TAG" \
    --notes "See [CHANGELOG.md](https://github.com/${REPO}/blob/main/CHANGELOG.md) for details." \
    --latest
  echo "  Created GitHub release $TAG"
fi

# --- 2. npm publish ---
echo ""
echo "==> [2/4] npm publish"
PUBLISHED=$(npm view servicenow-mcp-server version 2>/dev/null || echo "none")
if [ "$PUBLISHED" = "$VERSION" ]; then
  echo "  v${VERSION} already on npm, skipping"
else
  npm publish --access public
  echo "  Published servicenow-mcp-server@${VERSION} to npm"
fi

# --- 3. Docker Hub: login check ---
echo ""
echo "==> [3/4] Docker Hub login"
if ! docker login --username "$DOCKER_USER" 2>/dev/null; then
  echo "  Need Docker Hub credentials."
  docker login --username "$DOCKER_USER"
fi

# --- 4. Docker build + push ---
echo ""
echo "==> [4/4] Docker build & push"
FULL_IMAGE="${DOCKER_USER}/${DOCKER_IMAGE}"

# Extract major.minor for semver tags
MAJOR=$(echo "$VERSION" | cut -d. -f1)
MINOR=$(echo "$VERSION" | cut -d. -f1-2)

echo "  Building for linux/amd64,linux/arm64..."
docker buildx create --name release-builder --use 2>/dev/null || docker buildx use release-builder 2>/dev/null || true

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t "${FULL_IMAGE}:${VERSION}" \
  -t "${FULL_IMAGE}:${MINOR}" \
  -t "${FULL_IMAGE}:${MAJOR}" \
  -t "${FULL_IMAGE}:latest" \
  .

echo "  Pushed ${FULL_IMAGE}:{${VERSION},${MINOR},${MAJOR},latest}"

# --- Done ---
echo ""
echo "=========================================="
echo "  Release ${TAG} complete!"
echo "=========================================="
echo ""
echo "  GitHub:  https://github.com/${REPO}/releases/tag/${TAG}"
echo "  npm:     https://www.npmjs.com/package/servicenow-mcp-server/v/${VERSION}"
echo "  Docker:  https://hub.docker.com/r/${DOCKER_USER}/${DOCKER_IMAGE}/tags"
echo ""
