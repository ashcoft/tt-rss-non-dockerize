/**
 * Regression test: FeedTree must emit `select` for a feed item.
 *
 * The browser harness could not reliably trigger v-list-item clicks, so this
 * exercises the component with a stub VListItem that exposes the click handler
 * it was given. That proves the wiring from item click to emitted event, which
 * is what the app depends on to load headlines.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRenderer, defineComponent, h, nextTick } from 'vue';
import { parse, compileScript } from 'vue/compiler-sfc';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function compileComponent(relativePath) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'regression', inlineTemplate: true });
  const { outputText } = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  // Executes the compiled local component, not remote or user-supplied code.
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports.default;
}

const FeedTree = compileComponent('../../src/vue/components/FeedTree.vue');

/**
 * Mount FeedTree with a VListItem stub that records every element it renders
 * along with the click handler it was passed.
 */
function mountFeedTree(props) {
  const items = [];

  const renderer = createRenderer({
    createElement: (tag) => ({ tag, children: [], props: {} }),
    createText: (text) => ({ text }),
    createComment: (text) => ({ text }),
    setText: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; },
    patchProp: (node, key, _old, value) => { node.props[key] = value; },
    insert: (node, parent) => { (parent.children ||= []).push(node); node.parent = parent; },
    remove: (node) => {
      const index = node.parent?.children?.indexOf(node) ?? -1;
      if (index >= 0) node.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling: () => null,
  });

  const app = renderer.createApp(FeedTree, props);

  // VListItem records its props (including onClick) then renders its slots.
  app.component('VListItem', defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => {
        items.push(attrs);
        return h('item', null, [
          slots.prepend?.(),
          slots.default?.(),
          slots.append?.(),
        ]);
      };
    },
  }));

  const passthrough = defineComponent({
    setup(_props, { slots }) { return () => h('stub', null, slots.default?.()); },
  });
  // v-list-group renders its activator (a scoped slot) plus its children; a
  // plain passthrough would drop the activator and with it the category row.
  app.component('VListGroup', defineComponent({
    setup(_props, { slots }) {
      return () => h('group', null, [
        slots.activator?.({ props: {} }),
        slots.default?.(),
      ]);
    },
  }));
  for (const name of ['VTextField', 'VList', 'VIcon', 'VChip']) {
    app.component(name, passthrough);
  }

  app.mount({ children: [] });
  return items;
}

const feeds = [
  { id: 7, title: 'Alpha Feed', unread: 3, cat_id: null },
];

test('FeedTree emits select with the feed id when an uncategorized feed is clicked', async () => {
  const items = mountFeedTree({
    feeds,
    categories: [],
    labels: [],
    onSelect: (id, isCat) => { selected.push([id, isCat]); },
  });
  const selected = [];

  await nextTick();

  const feedItem = items.find((i) => i.title === 'Alpha Feed');
  assert.ok(feedItem, `expected an Alpha Feed item, saw: ${JSON.stringify(items.map(i => i.title))}`);
  assert.equal(typeof feedItem.onClick, 'function', 'feed item must have a click handler');

  feedItem.onClick();

  assert.deepEqual(selected, [[7, false]]);
});

test('FeedTree emits select with isCat true for a category item', async () => {
  const items = mountFeedTree({
    feeds: [{ id: 9, title: 'In Cat', unread: 1, cat_id: 3 }],
    categories: [{ id: 3, title: 'News', unread: 1, parent_id: null }],
    labels: [],
    onSelect: (id, isCat) => { selected.push([id, isCat]); },
  });
  const selected = [];

  await nextTick();

  const catItem = items.find((i) => i.title === 'News');
  assert.ok(catItem, `expected a News category, saw: ${JSON.stringify(items.map(i => i.title))}`);
  assert.equal(typeof catItem.onClick, 'function');

  catItem.onClick();

  assert.deepEqual(selected, [[3, true]]);
});
