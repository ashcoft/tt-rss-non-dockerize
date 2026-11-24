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
  const localRequire = (id) => {
    // Gesture wiring is not exercised by the render test.
    if (id.includes('useLongPressContextMenu')) {
      return { useLongPressContextMenu: () => {} };
    }
    return require(id);
  };
  // Executes the compiled local component, not remote or user-supplied code.
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports.default;
}

const FeedTree = compileComponent('../../src/vue/components/FeedTree.vue');

/**
 * Mount FeedTree with a VListItem stub that records every element it renders
 * along with the click handler it was passed.
 */
function mountFeedTree(props) {
  const items = [];
  const elements = [];

  const renderer = createRenderer({
    createElement: (tag) => {
      const node = { tag, children: [], props: {} };
      elements.push(node);
      return node;
    },
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
  const buttons = [];
  // VBtn records its props (including onClick and title) so a test can invoke
  // the reorder handlers.
  app.component('VBtn', defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => {
        buttons.push(attrs);
        return h('btn', null, slots.default?.());
      };
    },
  }));
  for (const name of ['VTextField', 'VList', 'VIcon', 'VChip']) {
    app.component(name, passthrough);
  }

  app.mount({ children: [] });
  return { items, buttons, elements };
}

const feeds = [
  { id: 7, title: 'Alpha Feed', unread: 3, cat_id: null },
];

test('FeedTree emits select with the feed id when an uncategorized feed is clicked', async () => {
  const { items } = mountFeedTree({
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
  const { items } = mountFeedTree({
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

test('FeedTree emits reorder when a feed move button is clicked', async () => {
  const reorders = [];
  const { buttons } = mountFeedTree({
    feeds: [{ id: 7, title: 'Alpha Feed', unread: 3, cat_id: null }],
    categories: [],
    labels: [],
    onReorder: (kind, id, delta) => { reorders.push([kind, id, delta]); },
  });

  await nextTick();

  const up = buttons.find((b) => b.title === 'Move feed up');
  const down = buttons.find((b) => b.title === 'Move feed down');
  assert.ok(up, 'expected a move-up button');
  assert.ok(down, 'expected a move-down button');

  // The buttons use @click.stop, so the handler expects an event.
  const event = { stopPropagation() {} };
  up.onClick(event);
  down.onClick(event);

  assert.deepEqual(reorders, [['feed', 7, -1], ['feed', 7, 1]]);
});

test('FeedTree emits reorder for categories', async () => {
  const reorders = [];
  const { buttons } = mountFeedTree({
    feeds: [],
    categories: [{ id: 3, title: 'News', unread: 0, parent_id: null }],
    labels: [],
    onReorder: (kind, id, delta) => { reorders.push([kind, id, delta]); },
  });

  await nextTick();

  const up = buttons.find((b) => b.title === 'Move category up');
  assert.ok(up, 'expected a move-category-up button');
  up.onClick({ stopPropagation() {} });

  assert.deepEqual(reorders, [['category', 3, -1]]);
});

test('FeedTree hides read feeds when hideRead is set', async () => {
  const { items } = mountFeedTree({
    feeds: [
      { id: 7, title: 'Unread Feed', unread: 2, cat_id: null },
      { id: 8, title: 'Read Feed', unread: 0, cat_id: null },
    ],
    categories: [],
    labels: [],
    hideRead: true,
  });

  await nextTick();

  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('Unread Feed'), `expected the unread feed, saw: ${titles}`);
  assert.ok(!titles.includes('Read Feed'), `read feed should be hidden, saw: ${titles}`);
});

test('FeedTree keeps the active feed visible while hiding read feeds', async () => {
  const { items } = mountFeedTree({
    feeds: [
      { id: 7, title: 'Unread Feed', unread: 2, cat_id: null },
      { id: 8, title: 'Read Feed', unread: 0, cat_id: null },
    ],
    categories: [],
    labels: [],
    hideRead: true,
    activeFeedId: 8,
  });

  await nextTick();

  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('Read Feed'), `active read feed must stay visible, saw: ${titles}`);
});

test('FeedTree renders each feed icon from the public.php endpoint', async () => {
  const { elements } = mountFeedTree({
    feeds: [{ id: 7, title: 'Alpha Feed', unread: 1, cat_id: null }],
    categories: [],
    labels: [],
    iconsUrl: '/public.php',
  });

  await nextTick();

  const icon = elements.find((e) => e.tag === 'img' && String(e.props.src ?? '').includes('feed_icon'));
  assert.ok(icon, `expected a feed icon img, saw: ${JSON.stringify(elements.map((e) => [e.tag, e.props.src]))}`);
  assert.equal(icon.props.src, '/public.php?op=feed_icon&id=7');
});

test('FeedTree selects a label through its synthetic negative feed id', async () => {
  const selected = [];
  const { items } = mountFeedTree({
    feeds: [],
    categories: [],
    labels: [{ id: 2, caption: 'Work' }],
    onSelect: (id, isCat) => { selected.push([id, isCat]); },
  });

  await nextTick();

  const labelItem = items.find((i) => i.title === 'Work');
  assert.ok(labelItem, `expected a label item, saw: ${JSON.stringify(items.map(i => i.title))}`);
  labelItem.onClick();

  // Feeds::view treats ids below LABEL_BASE_INDEX (-1024) as labels, and
  // Labels::label_to_feed_id() is LABEL_BASE_INDEX - 1 - labelId.
  assert.deepEqual(selected, [[-1024 - 1 - 2, false]]);
});
