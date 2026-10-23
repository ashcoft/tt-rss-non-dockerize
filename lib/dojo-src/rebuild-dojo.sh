#!/bin/bash
set -euo pipefail

# This script rebuilds customized layer of Dojo for tt-rss
# Place unpacked Dojo source release in this directory and run this script.
# It will automatically replace previous build of Dojo in ../dojo

# Dojo requires Java runtime to build. Further information on rebuilding Dojo
# is available here: https://dojotoolkit.org/reference-guide/build/index.html

VERSION=1.17.3

# Download and extract dojo src code if it doesn't already exist
if [ ! -d "dojo" ]; then
  TARBALL=dojo-release-$VERSION-src.tar.gz
  if [ ! -f $TARBALL ]; then
    wget https://download.dojotoolkit.org/release-$VERSION/$TARBALL
  fi
  tar -zxf $TARBALL
  mv dojo-release-$VERSION-src/* .
  rm -rf dojo-release-$VERSION-src
fi

if [ -d util/buildscripts/ ]; then
  rm -rf release/dojo

  pushd util/buildscripts
      ./build.sh profile=../../tt-rss action=release optimize=shrinksafe cssOptimize=comments
  popd

  if [ -d release/dojo ]; then
    rm -rf ../dojo ../dijit
    cp -r release/dojo/dojo ..
    cp -r release/dojo/dijit ..

    cd ..

    find dojo -name '*uncompressed*' -exec rm -- {} \;
    find dijit -name '*uncompressed*' -exec rm -- {} \;

    # The release archive also ships package.json/package-lock.json for Dojo's
    # own intern-based test harness. tt-rss never installs or runs those tests,
    # and their obsolete devDependencies cannot be patched, so Dependabot
    # security update jobs for lib/dojo failed with
    # `security_update_not_possible`. Keep only the runtime metadata.
    rm -f dojo/package-lock.json
    if command -v node >/dev/null 2>&1; then
      node -e 'const fs = require("fs"); const p = "dojo/package.json"; const manifest = JSON.parse(fs.readFileSync(p, "utf8")); delete manifest.scripts; delete manifest.devDependencies; fs.writeFileSync(p, JSON.stringify(manifest, null, "\t") + "\n");'
    else
      echo "$0: warning: node not found, remove scripts/devDependencies from dojo/package.json manually."
    fi
  else
    echo "$0: ERROR: Dojo build seems to have failed."
  fi
else
  echo "$0: ERROR: Please unpack Dojo source release into current directory."
fi
