/**
 * Regression tests for the runDetached helper.
 *
 * It exists specifically to attach a rejection handler to fire-and-forget
 * calls, so the important behaviour to pin is that a rejection is caught and
 * reported rather than escaping as an unhandled rejection.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadTsModule(relativePath) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const module = { exports: {} };
  // Executes the compiled local module, not remote or user-supplied code.
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports;
}

const { runDetached } = loadTsModule('../../src/vue/utils/runDetached.ts');

/** Capture console.error for the duration of `body`. */
async function captureErrors(body) {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(' '));

  try {
    await body();
  } finally {
    console.error = original;
  }

  return logs;
}

test('runDetached reports a rejection instead of letting it escape', async () => {
  const logs = await captureErrors(async () => {
    runDetached(Promise.reject(new Error('boom')), 'toggle star');
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.equal(logs.length, 1, `expected one log, saw: ${JSON.stringify(logs)}`);
  assert.ok(logs[0].includes('toggle star failed'), logs[0]);
  assert.ok(logs[0].includes('boom'), logs[0]);
});

test('runDetached stays quiet when the promise resolves', async () => {
  const logs = await captureErrors(async () => {
    runDetached(Promise.resolve('ok'), 'refresh');
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.deepEqual(logs, []);
});
