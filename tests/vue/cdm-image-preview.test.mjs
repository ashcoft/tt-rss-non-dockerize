/**
 * Regression tests for the combined-view row thumbnail.
 *
 * A collapsed row carries a `.cdm-image-preview` <img> between its header and
 * body. The body already shows that image (or, for a video, the player whose
 * poster it is), so the thumbnail must be hidden whenever the body is visible.
 *
 * Core themes express that with CSS, but a theme installed under themes.local
 * ships no such rules, so the state is driven from JS. These tests run without
 * any theme CSS, which is exactly the failing case: if a call to
 * syncImagePreview() is dropped, the duplicate comes back for local themes.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const articleSrc = readFileSync(
  fileURLToPath(new URL('../../js/Article.js', import.meta.url)), 'utf8');

// js/Article.js is a browser module: it defines `const Article` and then
// publishes it on `window`. Evaluate it against a stub window and hand back
// the object, the same way the page does.
function loadArticle() {
  const window = {};
  new Function('window', articleSrc)(window);
  return window.Article;
}

// Minimal element supporting the classList / querySelector surface
// syncImagePreview() touches. Deliberately no computed style: the point is
// that visibility comes from the inline style, not from a stylesheet.
function makeRow(classes, hasPreview = true) {
  const preview = hasPreview ? { style: {} } : null;
  const classes_ = new Set(classes.split(' '));
  return {
    classList: {
      contains: (c) => classes_.has(c),
      add: (c) => classes_.add(c),
      remove: (c) => classes_.delete(c),
    },
    querySelector: (sel) => (sel === '.cdm-image-preview' ? preview : null),
  };
}

const Article = loadArticle();

test('syncImagePreview hides the thumbnail on a row that is expanded from the start', () => {
  const row = makeRow('cdm expanded');
  Article.syncImagePreview(row);

  assert.equal(row.querySelector('.cdm-image-preview').style.display, 'none',
    'an expanded row shows the image in its body already, so the thumbnail is hidden');
});

test('syncImagePreview shows the thumbnail on a collapsed row', () => {
  const row = makeRow('cdm expandable');
  Article.syncImagePreview(row);

  assert.equal(row.querySelector('.cdm-image-preview').style.display, '',
    'a collapsed row has no body, so the thumbnail is the only image');
});

test('opening and closing a row toggles the thumbnail', () => {
  const row = makeRow('cdm expandable');

  Article.syncImagePreview(row);
  assert.equal(row.querySelector('.cdm-image-preview').style.display, '',
    'starts visible while collapsed');

  row.classList.add('active');
  Article.syncImagePreview(row);
  assert.equal(row.querySelector('.cdm-image-preview').style.display, 'none',
    'opening the row must hide the thumbnail, or the image renders twice');

  row.classList.remove('active');
  Article.syncImagePreview(row);
  assert.equal(row.querySelector('.cdm-image-preview').style.display, '',
    'closing the row brings the thumbnail back');
});

test('syncImagePreview tolerates a row with no thumbnail', () => {
  const row = makeRow('cdm expandable', false);

  assert.doesNotThrow(() => Article.syncImagePreview(row),
    'rows without an image_preview carry no thumbnail element');
});
