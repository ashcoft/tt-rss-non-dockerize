#!/usr/bin/env bash
#
# Build tt-rss.tar.gz and tt-rss.zip for a vite-dev release.
#
# Usage: package-release-assets.sh <tag>
#
# The archives ship without .git, so bake the tag into version_static.txt;
# Config::get_version() reads it when git metadata is unavailable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

tag="${1:?usage: package-release-assets.sh <tag>}"

if ! command -v zip >/dev/null 2>&1; then
  echo "package-release-assets: zip is required" >&2
  exit 1
fi

printf '%s\n' "$tag" > version_static.txt
rm -f tt-rss.tar.gz tt-rss.zip

# Unlike the main release, which is built from a clean CI checkout, this runs
# in a working tree that may hold local credentials and user data. Exclude
# those so they cannot leak into a published asset.
local_excludes=(
  './.env' './.env.*'
  './config.php'
  './cache/*' './lock/*' './feed-icons/*'
  './plugins.local/*' './themes.local/*' './templates.local/*'
  './test-results/*' './playwright-report/*' './.playwright/*'
  './.phpunit*cache' './.phpstan-tmp/*' './.rector-tmp/*' './.tools/*'
)

# The dev packages include dist/ (the built Vue app), unlike the legacy
# main release which ships without it.
tar_args=(
  --exclude='.git' --exclude='.github' --exclude='node_modules'
  --exclude='*.log' --exclude='*.tmp' --exclude='*.ts' --exclude='*.less'
  --exclude='package-lock.json' --exclude='pnpm-lock.yaml'
  --exclude='*.tar.gz' --exclude='*.zip'
)
for pattern in "${local_excludes[@]}"; do
  tar_args+=(--exclude="$pattern")
done
tar "${tar_args[@]}" -czf /tmp/tt-rss.tar.gz . && mv /tmp/tt-rss.tar.gz .

zip_args=(
  -x '.git/*' -x '.github/*' -x 'node_modules/*'
  -x '*.log' -x '*.tmp' -x '*.ts' -x '*.less'
  -x 'package-lock.json' -x 'pnpm-lock.yaml'
  -x '*.tar.gz' -x '*.zip'
)
for pattern in "${local_excludes[@]}"; do
  zip_args+=(-x "${pattern#./}")
done
zip -r /tmp/tt-rss.zip . "${zip_args[@]}" && mv /tmp/tt-rss.zip .
