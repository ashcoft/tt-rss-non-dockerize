/**
 * Regression tests for headline store cursor navigation.
 *
 * Exercises the real store (`src/vue/stores/headlines.ts`). `pinia` and `vue`
 * are replaced with minimal stand-ins so the setup function can run outside a
 * component; everything else, including the API client, is the shipping code.
 * No network calls are made by these tests.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const SRC_VUE = fileURLToPath(new URL('../../src/vue/', import.meta.url));

// Minimal reactivity: enough for the store's ref/computed usage under test.
const vueStub = {
  ref: (value) => ({ value }),
  computed: (fn) => ({ get value() { return fn(); } }),
  reactive: (obj) => obj,
};

// defineStore(id, setup) returns the setup itself, so calling it yields state.
const piniaStub = { defineStore: (_id, setup) => setup };

function loadTsModule(specifier, cache = new Map()) {
  if (specifier === 'vue') return vueStub;
  if (specifier === 'pinia') return piniaStub;

  const base = specifier.startsWith('/') ? `file://${specifier}` : new URL(specifier, `file://${SRC_VUE}`).href;
  const resolved = base.endsWith('.ts') ? fileURLToPath(base) : fileURLToPath(`${base}.ts`);
  if (cache.has(resolved)) return cache.get(resolved);

  const source = readFileSync(resolved, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });

  const module = { exports: {} };
  cache.set(resolved, module.exports);

  const localRequire = (id) => {
    if (id.startsWith('.')) {
      const target = fileURLToPath(new URL(id, new URL(`file://${resolved}`)));
      return loadTsModule(target, cache);
    }
    return loadTsModule(id, cache);
  };

  // Executes the compiled local module, not remote or user-supplied code.
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports;
}

const { useHeadlinesStore } = loadTsModule('stores/headlines.ts');

function headline(id) {
  return { id, title: `Article ${id}`, is_read: false, feed_id: 1 };
}

/** Build a store with a fixed headline list, bypassing any network access. */
function storeWith(ids) {
  const store = useHeadlinesStore();
  store.headlines.value = ids.map(headline);
  return store;
}

test('cursor starts unset and moves to the first entry on forward navigation', () => {
  const store = storeWith([10, 20, 30]);

  assert.equal(store.cursorId.value, null);
  assert.equal(store.cursorIndex.value, -1);

  const moved = store.moveCursor(1);

  assert.equal(store.cursorId.value, 10);
  assert.equal(moved.id, 10);
  assert.equal(store.cursorIndex.value, 0);
});

test('backward navigation from unset lands on the last entry', () => {
  const store = storeWith([10, 20, 30]);

  store.moveCursor(-1);

  assert.equal(store.cursorId.value, 30);
  assert.equal(store.cursorIndex.value, 2);
});

test('cursor movement is clamped at both ends', () => {
  const store = storeWith([10, 20, 30]);

  store.moveCursor(1); // 10
  store.moveCursor(1); // 20
  store.moveCursor(1); // 30
  assert.equal(store.cursorId.value, 30);

  store.moveCursor(1); // still 30
  assert.equal(store.cursorId.value, 30, 'must not run past the end');

  store.moveCursor(-1);
  store.moveCursor(-1);
  store.moveCursor(-1); // 10
  store.moveCursor(-1); // still 10
  assert.equal(store.cursorId.value, 10, 'must not run before the start');
});

test('cursorHeadline returns the entry under the cursor', () => {
  const store = storeWith([10, 20, 30]);

  store.setCursor(20);

  assert.equal(store.cursorHeadline.value.id, 20);
  assert.equal(store.cursorHeadline.value.title, 'Article 20');
});

test('cursorHeadline is null when the cursor points at a missing entry', () => {
  const store = storeWith([10, 20]);

  store.setCursor(999);

  assert.equal(store.cursorHeadline.value, null);
  assert.equal(store.cursorIndex.value, -1);
});

test('moving the cursor in an empty list is a no-op', () => {
  const store = storeWith([]);

  assert.equal(store.moveCursor(1), null);
  assert.equal(store.cursorId.value, null);
});

test('reset clears the cursor', () => {
  const store = storeWith([10, 20]);
  store.setCursor(20);

  store.reset();

  assert.equal(store.cursorId.value, null);
});
