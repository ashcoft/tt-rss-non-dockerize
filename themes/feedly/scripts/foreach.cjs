#!/usr/bin/env node
/*
 * Minimal `foreach` replacement for the theme build scripts.
 *
 * The abandoned @goenning/foreach-cli pinned glob@6, whose only accepted
 * minimatch range ("2 || 3") is entirely covered by GHSA-g3hv-75wg-m249 and
 * crashes under the patched minimatch 11. Driving glob@14 directly keeps the
 * build on a patched minimatch without the incompatible transitive path.
 */
(() => {
  'use strict';

  const { execSync } = require('node:child_process');
  const path = require('node:path');
  const { globSync } = require('glob');

  const PLACEHOLDER = /(?:#\{|\{\{)([^/}]+)(?:\}\}|\})/g;

  /**
   * Reads the value that follows the first matching option name.
   *
   * @param {string[]} argv - The raw process arguments.
   * @param {...string} names - The option names to look for, e.g. "-g".
   * @returns {string|undefined} The option value, or undefined when absent.
   */
  function readOption(argv, ...names) {
    for (const name of names) {
      const index = argv.indexOf(name);
      if (index !== -1) {
        return argv[index + 1];
      }
    }
    return undefined;
  }

  /**
   * Quotes a value so the shell treats it as a single literal argument.
   *
   * Substituted file names are glob-derived, so without this a name that
   * contains spaces would split into several arguments and a name containing
   * shell metacharacters would be executed by the build.
   *
   * @param {string} value - The value to quote.
   * @returns {string} The value wrapped in single quotes.
   */
  function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Collects every placeholder value for one matched file.
   *
   * @param {string} file - The matched file path.
   * @returns {Record<string, string>} The placeholder name to value mapping.
   */
  function placeholdersFor(file) {
    const parsed = path.parse(file);

    return {
      path: file,
      root: parsed.root,
      dir: parsed.dir,
      reldir: path.dirname(file),
      base: parsed.base,
      ext: parsed.ext,
      name: parsed.name,
    };
  }

  /**
   * Substitutes the placeholders in a command template for one file, quoting
   * every substituted value so the shell cannot interpret it.
   *
   * @param {string} command - The command template passed with -x.
   * @param {string} file - The matched file path.
   * @returns {string} The expanded, shell-safe command.
   */
  function expand(command, file) {
    const placeholders = placeholdersFor(file);

    return command.replace(PLACEHOLDER, (match, token) => {
      if (!Object.prototype.hasOwnProperty.call(placeholders, token)) {
        throw new Error(`foreach: unknown placeholder ${match}`);
      }
      return shellQuote(placeholders[token]);
    });
  }

  /**
   * Runs the command template once for each file matched by the glob.
   *
   * @returns {void}
   */
  function main() {
    const argv = process.argv.slice(2);
    const pattern = readOption(argv, '-g', '--glob');
    const command = readOption(argv, '-x', '--execute');

    if (!pattern || !command) {
      console.error("usage: foreach -g '<glob>' -x '<command>'");
      process.exit(2);
    }

    const files = globSync(pattern, { nodir: true }).sort();
    if (files.length === 0) {
      console.error(`foreach: no files matched '${pattern}'`);
      process.exit(1);
    }

    for (const file of files) {
      execSync(expand(command, file), { stdio: 'inherit', shell: true });
    }
  }

  main();
})();
