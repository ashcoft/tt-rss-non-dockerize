#!/usr/bin/env node
/*
 * Minimal `foreach` replacement for the theme build scripts.
 *
 * The abandoned @goenning/foreach-cli pinned glob@6, whose only accepted
 * minimatch range ("2 || 3") is entirely covered by GHSA-g3hv-75wg-m249 and
 * crashes under the patched minimatch 11. Driving glob@14 directly keeps the
 * build on a patched minimatch without the incompatible transitive path.
 */
const { execSync } = require('node:child_process');
const path = require('node:path');
const { globSync } = require('glob');

const argv = process.argv.slice(2);

function readOption(...names) {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index !== -1) {
      return argv[index + 1];
    }
  }
  return undefined;
}

const pattern = readOption('-g', '--glob');
const command = readOption('-x', '--execute');

if (!pattern || !command) {
  console.error("usage: foreach -g '<glob>' -x '<command>'");
  process.exit(2);
}

const PLACEHOLDER = /(?:#\{|\{\{)([^/}]+)(?:\}\}|\})/g;

function expand(file) {
  const parsed = path.parse(file);

  return command.replace(PLACEHOLDER, (match, token) => {
    switch (token) {
      case 'path': return file;
      case 'root': return parsed.root;
      case 'dir': return parsed.dir;
      case 'reldir': return path.dirname(file);
      case 'base': return parsed.base;
      case 'ext': return parsed.ext;
      case 'name': return parsed.name;
      default: return match;
    }
  });
}

for (const file of globSync(pattern, { nodir: true }).sort()) {
  execSync(expand(file), { stdio: 'inherit', shell: true });
}
