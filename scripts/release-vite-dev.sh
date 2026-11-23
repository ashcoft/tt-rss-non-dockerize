#!/usr/bin/env bash
#
# Release the vite-dev line with semantic-release.
#
# semantic-release reads one .releaserc from the working directory, so this
# temporarily swaps in the vite-dev configuration (vite-dev-<version> tag
# namespace, patch-only versions from the 0.0.0 baseline) and restores the
# main configuration afterwards. semantic-release creates the tag and GitHub
# release; the new dev release is then kept out of GitHub's "latest" slot so
# the stable main release stays latest.
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

previous_latest=""
if command -v gh >/dev/null 2>&1; then
  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
  if [[ -n "$repo" ]]; then
    previous_latest=$(gh api "repos/$repo/releases/latest" --jq .tag_name 2>/dev/null || true)
  fi
fi

backup=$(mktemp)
cp .releaserc.json "$backup"
restore() {
  cp "$backup" .releaserc.json
  rm -f "$backup"
}
trap restore EXIT INT TERM

cp .releaserc.vite-dev.json .releaserc.json

args=("$@")
if [[ -z "${CI:-}" ]]; then
  args+=(--no-ci)
fi

corepack pnpm exec semantic-release "${args[@]}"

tag=$(git describe --tags --abbrev=0 --match 'vite-dev-*')
if command -v gh >/dev/null 2>&1 && [[ -n "$tag" ]]; then
  gh release edit "$tag" --latest=false >/dev/null 2>&1 || true
  if [[ -n "$previous_latest" ]]; then
    gh release edit "$previous_latest" --latest=true >/dev/null 2>&1 || true
  fi
fi

echo "release-vite-dev: released $tag"
