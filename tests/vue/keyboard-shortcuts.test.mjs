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
  constructor(tagName, control = null) {
    this.tagName = tagName;
    this.isContentEditable = false;
    this.control = control;
  }

  closest() {
    return this.control;
  }
}

globalThis.HTMLElement = FakeHTMLElement;

const { createKeyHandler } = loadKeyboardModule();

/** A DOM-like target whose `closest` reports the control that owns it. */
function target(tagName, control = null) {
  return new FakeHTMLElement(tagName, control);
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
  const button = target('BUTTON', { tagName: 'BUTTON' });

  handler(keydown('j', button));
  handler(keydown('k', button));
  handler(keydown('r', button));

  assert.deepEqual(calls, ['next', 'previous', 'read']);
});

test('a focused button keeps its own activation keys', () => {
  const { calls, shortcuts } = spyHandler();
  const handler = createKeyHandler(shortcuts);
  const button = target('BUTTON', { tagName: 'BUTTON' });

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
  const option = target('OPTION', { tagName: 'SELECT' });

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
