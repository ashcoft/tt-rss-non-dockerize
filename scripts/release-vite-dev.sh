#!/usr/bin/env bash
#
# Release the vite-dev line with semantic-release.
#
# semantic-release reads one .releaserc from the working directory, so this
# temporarily swaps in the vite-dev configuration (vite-dev-<version> tag
# namespace, patch-only versions from the 0.0.0 baseline) and restores the
# main configuration afterwards. semantic-release creates the tag and GitHub
# release; this script then attaches tt-rss.tar.gz and tt-rss.zip, mirroring
# the main release assets, and keeps the new dev release out of GitHub's
# "latest" slot so the stable main release stays latest.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(git rev-parse --abbrev-ref HEAD)" != "vite-dev" ]]; then
  echo "release-vite-dev: expected branch vite-dev, got $(git rev-parse --abbrev-ref HEAD)" >&2
  exit 1
fi

if [[ ! -f .releaserc.vite-dev.json ]]; then
  echo "release-vite-dev: .releaserc.vite-dev.json is missing" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "release-vite-dev: gh is required to upload release assets" >&2
  exit 1
fi

previous_latest=""
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
if [[ -n "$repo" ]]; then
  previous_latest=$(gh api "repos/$repo/releases/latest" --jq .tag_name 2>/dev/null || true)
fi

backup=$(mktemp)
cp .releaserc.json "$backup"
restore() {
  if [[ -f "$backup" ]]; then
    cp "$backup" .releaserc.json
    rm -f "$backup"
  fi
}
trap restore EXIT INT TERM

cp .releaserc.vite-dev.json .releaserc.json

args=("$@")
if [[ -z "${CI:-}" ]]; then
  args+=(--no-ci)
fi

# Pin pnpm 9 to match CI: corepack's default (pnpm 12) refuses the pnpm
# overrides still declared in package.json.
# Build before semantic-release so a broken build aborts without creating a tag.
corepack pnpm@9 run build
corepack pnpm@9 exec semantic-release "${args[@]}"

# Restore the main config before packaging so the archives do not ship the
# vite-dev release config as .releaserc.json.
restore

tag=$(git describe --tags --abbrev=0 --match 'vite-dev-*')
if [[ "$(git rev-list -n 1 "$tag")" != "$(git rev-parse HEAD)" ]]; then
  echo "release-vite-dev: no new release; skipping asset upload"
  exit 0
fi

bash scripts/package-release-assets.sh "$tag"
gh release upload "$tag" tt-rss.tar.gz tt-rss.zip --clobber

gh release edit "$tag" --latest=false >/dev/null 2>&1 || true
if [[ -n "$previous_latest" ]]; then
  gh release edit "$previous_latest" --latest=true >/dev/null 2>&1 || true
fi

echo "release-vite-dev: released $tag with tt-rss.tar.gz and tt-rss.zip"
