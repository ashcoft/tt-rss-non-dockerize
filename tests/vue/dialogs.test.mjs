import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRenderer, defineComponent, h, nextTick } from 'vue';
import { parse, compileScript } from 'vue/compiler-sfc';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/**
 * Resolve the modules the compiled sources import. A switch (rather than a
 * keyed lookup) keeps every require() argument a literal.
 */
function requireModule(id) {
  switch (id) {
    case 'typescript':
      return require('typescript');
    case 'vue':
      return require('vue');
    case 'pinia':
      return require('pinia');
    default:
      throw new Error(`Refusing to require unexpected module: ${id}`);
  }
}

// Local modules the components under test import, mapped to their sources.
const LOCAL_SOURCES = {
  '@/composables/useInfiniteScroll': '../../src/vue/composables/useInfiniteScroll.ts',
  '../../utils/runDetached': '../../src/vue/utils/runDetached.ts',
  '../utils/pluginIcons': '../../src/vue/utils/pluginIcons.ts',
};

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
    if (id.includes('api/client')) {
      return {
        __esModule: true,
        default: {
          getPluginPrefsSection: async () => ({ status: 1, content: '' }),
          invokePluginHandler: async () => ({ status: 1, content: '' }),
        },
      };
    }
    // PluginSurface imports this helper; the render tests do not exercise it.
    if (id.includes('api/legacyEndpoints')) {
      return { preparePluginSurfaceHtml: (value) => value };
    }
    // DOMPurify needs a DOM; a passthrough stub is enough for the render tests.
    // __esModule makes the transpiled `import DOMPurify from 'dompurify'` read
    // our `default` rather than double-wrapping it.
    if (id === 'dompurify') {
      return { __esModule: true, default: { sanitize: (value) => value } };
    }
    // The Pinia stores pull in a large dependency graph that this renderer
    // does not need; a minimal stub is enough for the dialog under test.
    if (id === '../../stores' || id === '../stores') {
      return { useFeedsStore: () => ({ feeds: [], categories: [] }) };
    }
    // Sibling dialogs import each other; compile them on demand.
    if (id.endsWith('.vue')) {
      const name = id.replace(/^\.\//, '');
      return { default: compileComponent(`../../src/vue/components/dialogs/${name}`) };
    }
    // Local .ts sources the components import are compiled on demand; the
    // allowlist in requireModule only covers third-party packages.
    const local = LOCAL_SOURCES[id];
    if (local !== undefined) {
      const source = readFileSync(new URL(local, import.meta.url), 'utf8');
      const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const exports = {};
      new Function('require', 'exports', compiled)(require, exports);
      return exports;
    }
    return requireModule(id);
  };
  // Execute the compiled local component, not remote or user-supplied code.
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports.default;
}

function mount(Component, extraProps = {}) {
  let dialogProps;
  const renderer = createRenderer({
    createElement: (tag) => ({
      tag, children: [], listeners: new Map(),
      scrollTop: 0, scrollHeight: 100, clientHeight: 100,
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      removeEventListener(name, callback) {
        if (this.listeners.get(name) === callback) this.listeners.delete(name);
      },
    }),
    createText: (text) => ({ text }),
    createComment: (text) => ({ text }),
    setText: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; },
    patchProp: (node, key, _old, value) => { node[key] = value; },
    insert: (node, parent) => { parent.children.push(node); node.parent = parent; },
    remove: (node) => {
      const index = node.parent?.children.indexOf(node);
      if (index >= 0) node.parent.children.splice(index, 1);
    },
    parentNode: (node) => node.parent,
    nextSibling: () => null,
  });
  const updates = [];
  const app = renderer.createApp(Component, {
    modelValue: false,
    'onUpdate:modelValue': (value) => updates.push(value),
    ...extraProps,
  });
  const passthrough = defineComponent({
    setup(_props, { slots }) { return () => h('stub', null, slots.default?.()); },
  });
  app.component('VDialog', defineComponent({
    inheritAttrs: false,
    props: { modelValue: Boolean },
    setup(props, { attrs, slots }) {
      return () => {
        dialogProps = { ...attrs, modelValue: props.modelValue };
        return h('dialog', null, slots.default?.());
      };
    },
  }));
  for (const name of ['VCard', 'VCardTitle', 'VCardText', 'VCardActions', 'VTabs', 'VTab',
    'VWindow', 'VWindowItem', 'VList', 'VListItem', 'VListItemTitle', 'VListItemSubtitle',
    'VCheckbox', 'VTextField', 'VTextarea', 'VSelect', 'VBtn', 'VSpacer', 'VDivider', 'VIcon',
    'VChip', 'VAlert', 'VProgressCircular', 'VSnackbar']) app.component(name, passthrough);
  const root = { children: [] };
  app.mount(root);
  return { app, root, updates, dialog: () => dialogProps };
}

for (const name of ['LabelsDialog', 'PreferencesDialog', 'HotkeyHelpDialog']) {
  test(`${name} forwards dialog updates without mutating its prop`, async () => {
    const Component = compileComponent(`../../src/vue/components/dialogs/${name}.vue`);
    const mounted = mount(Component);
    try {
      assert.equal(mounted.dialog().modelValue, false);
      mounted.dialog()['onUpdate:modelValue'](true);
      mounted.dialog()['onUpdate:modelValue'](false);
      await nextTick();
      assert.deepEqual(mounted.updates, [true, false]);
      assert.equal(mounted.dialog().modelValue, false);
    } finally {
      mounted.app.unmount();
    }
  });
}

for (const [label, flags, expected] of [
  ['ready', { hasMore: true, loading: false, loadingMore: false }, 1],
  ['loading', { hasMore: true, loading: true }, 0],
  ['loading more', { hasMore: true, loadingMore: true }, 0],
  ['exhausted', { hasMore: false }, 0],
]) {
  test(`HeadlinesList scroll listener: ${label}, then unmount`, async () => {
    const Component = compileComponent('../../src/vue/components/HeadlinesList.vue');
    let requests = 0;
    const mounted = mount(Component, {
      headlines: [], loading: false, ...flags,
      'onLoad-more': () => { requests++; },
    });
    const container = mounted.root.children[0];
    try {
      assert.equal(container.tag, 'div');
      assert.equal(typeof container.listeners.get('scroll'), 'function');
      container.listeners.get('scroll')();
      container.listeners.get('scroll')();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requests, expected);
    } finally {
      mounted.app.unmount();
    }
    assert.equal(container.listeners.has('scroll'), false);
  });
}

test('every preference the dialog lists is exposed by RPC/sanityCheck', () => {
  // RPC/sanityCheck init-params is the only endpoint that returns preference
  // values. A preference listed in the dialog but absent here renders blank,
  // and saving it silently overwrites the real value with a default.
  const dialogSource = readFileSync(
    fileURLToPath(new URL('../../src/vue/components/dialogs/PreferencesDialog.vue', import.meta.url)),
    'utf8'
  );
  const rpcSource = readFileSync(
    fileURLToPath(new URL('../../classes/RPC.php', import.meta.url)),
    'utf8'
  );

  const dialogPrefs = [...dialogSource.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(dialogPrefs.length > 0, 'expected to find preference names in the dialog');

  // Restrict to the _make_init_params() method so unrelated Prefs:: uses in
  // RPC.php do not mask a missing entry.
  const methodStart = rpcSource.indexOf('function _make_init_params');
  assert.ok(methodStart > -1, 'could not locate _make_init_params in RPC.php');
  const methodBody = rpcSource.slice(methodStart, rpcSource.indexOf('private function image_to_base64', methodStart));
  const exposed = new Set(
    [...methodBody.matchAll(/Prefs::([A-Z_]+)/g)].map((m) => m[1].toLowerCase())
  );

  const missing = dialogPrefs.filter((name) => !exposed.has(name));
  assert.deepEqual(missing, [], `these dialog preferences are not in init-params: ${missing.join(', ')}`);
});
