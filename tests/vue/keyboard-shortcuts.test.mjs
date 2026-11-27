/**
 * Regression tests for the global keyboard handler.
 *
 * `useKeyboard` listens on the document, so these drive the exported handler
 * with fake events. The case that matters most: clicking a button leaves focus
 * on it, and the reading shortcuts must keep working while the control still
 * receives its own Enter/Space activation.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadKeyboardModule() {
  const filename = fileURLToPath(
    new URL('../../src/vue/composables/useKeyboard.ts', import.meta.url)
  );
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  // Executes the compiled local composable, not remote or user-supplied code.
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports;
}

/** Node has no DOM: stand in for the element type the handler checks against. */
class FakeHTMLElement {
  constructor(tagName, { control = null, inArticle = false } = {}) {
    this.tagName = tagName;
    this.isContentEditable = false;
    this.control = control;
    this.inArticle = inArticle;
  }

  closest(selector) {
    if (selector.includes('article-panel')) return this.inArticle ? this : null;
    return this.control;
  }
}

globalThis.HTMLElement = FakeHTMLElement;

const { createKeyHandler } = loadKeyboardModule();

/** A DOM-like target whose `closest` reports the control that owns it. */
function target(tagName, options = {}) {
  return new FakeHTMLElement(tagName, options);
}

function keydown(key, eventTarget, overrides = {}) {
  return {
    key,
    target: eventTarget,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...overrides,
  };
}

function spyHandler() {
  const calls = [];
  return {
    calls,
    shortcuts: {
      onNext: () => calls.push('next'),
      onPrevious: () => calls.push('previous'),
      onSelect: () => calls.push('select'),
      onOpenArticle: () => calls.push('open'),
      onToggleRead: () => calls.push('read'),
    },
  };
}

test('reading shortcuts still run while a button has focus', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);
  const button = target('BUTTON', { control: { tagName: 'BUTTON' } });

  handler(keydown('j', button));
  handler(keydown('k', button));
  handler(keydown('r', button));

  assert.deepEqual(calls, ['next', 'previous', 'read']);
});

test('a focused button keeps its own activation keys', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);
  const button = target('BUTTON', { control: { tagName: 'BUTTON' } });

  const enter = keydown('Enter', button);
  handler(enter);
  const space = keydown(' ', button);
  handler(space);

  assert.deepEqual(calls, []);
  assert.equal(enter.prevented, false);
  assert.equal(space.prevented, false);
});

test('a select keeps the arrow keys that move its selection', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);
  const option = target('OPTION', { control: { tagName: 'SELECT' } });

  handler(keydown('ArrowDown', option));

  assert.deepEqual(calls, []);
});

test('text fields swallow every shortcut', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);

  const editable = new FakeHTMLElement('DIV');
  editable.isContentEditable = true;

  handler(keydown('j', target('INPUT')));
  handler(keydown('j', editable));

  assert.deepEqual(calls, []);
});

test('an event another handler consumed is ignored', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);

  handler(keydown('j', target('DIV'), { defaultPrevented: true }));

  assert.deepEqual(calls, []);
});

test('arrows scroll the reading pane instead of moving the cursor', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);
  const link = target('A', { control: { tagName: 'A' }, inArticle: true });

  const down = keydown('ArrowDown', link);
  handler(down);
  const up = keydown('ArrowUp', link);
  handler(up);

  assert.deepEqual(calls, []);
  assert.equal(down.prevented, false);
  assert.equal(up.prevented, false);

  // j/k stay explicit reading shortcuts, even inside the pane.
  handler(keydown('j', link));
  assert.deepEqual(calls, ['next']);
});

test('arrows still navigate when focus is outside the reading pane', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);

  handler(keydown('ArrowDown', target('BODY')));

  assert.deepEqual(calls, ['next']);
});
