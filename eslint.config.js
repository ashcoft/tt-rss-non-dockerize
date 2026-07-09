import globals from 'globals';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import vueParser from 'vue-eslint-parser';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      '.github/**',
      'node_modules/**',
      'dist/**',
      'lib/dojo/**',
      'lib/dijit/**',
      'lib/dojox/**',
      'vendor/**'
    ]
  },

  js.configs.recommended,

  {
    files: ['js/**/*.js', 'plugins/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,

        // Dojo
        dojo: 'readonly',
        dijit: 'readonly'
      }
    },

    plugins: {
      '@stylistic/js': stylistic
    },

    rules: {
      'no-console': 'off',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always'],
      'no-empty': ['error', { 'allowEmptyCatch': true }],

      // Security — block the eval family and javascript: URLs
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-extend-native': 'error',

      // Correctness / bug catchers
      'array-callback-return': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-constructor-return': 'error',
      'no-new-wrappers': 'error',

      // Modernization (companions to prefer-const)
      'no-var': 'error',
      'prefer-spread': 'error',
      'prefer-object-spread': 'error',
      'no-useless-rename': 'error',

      // Stylistic rules (replacing those deprecated in ESLint)
      '@stylistic/js/linebreak-style': ['error', 'unix'],
      '@stylistic/js/eol-last': 'error',
      '@stylistic/js/no-trailing-spaces': 'error',
      '@stylistic/js/no-multiple-empty-lines': ['error', { 'max': 2 }],
      '@stylistic/js/keyword-spacing': ['error', { 'after': true, 'before': true }],
      '@stylistic/js/block-spacing': ['error', 'always'],
      '@stylistic/js/computed-property-spacing': ['error', 'never'],
      // Disable max-statements-per-line for pre-existing js files
      '@stylistic/js/max-statements-per-line': 'off',

      // Explicitly disable style/legacy rules that clash with the inherited
      // upstream tt-rss sources in js/. DeepSource's JavaScript analyzer
      // respects rules explicitly disabled here and will not raise their
      // equivalent issues (JS-0240, JS-0049, JS-0052, JS-0119, JS-0099,
      // JS-0246, JS-0047, JS-0241, JS-C1002, JS-R1005).
      'dot-notation': 'off',
      'object-shorthand': 'off',
      'no-alert': 'off',
      'init-declarations': 'off',
      'no-warning-comments': 'off',
      'prefer-template': 'off',
      'default-case': 'off',
      'prefer-arrow-callback': 'off',
      'id-length': 'off',
      'complexity': 'off'
    }
  },

  // src directory - ES modules with browser globals
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser
      }
    },
    plugins: {
      '@stylistic/js': stylistic
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always'],
      'no-empty': ['error', { 'allowEmptyCatch': true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },

  // TypeScript files
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {
          ...globals.browser,
          ...globals.node,
          console: 'readonly'
        }
      }
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error', 'warn', 'log'] }],
      'no-undef': 'off'
    }
  },

  // Vue files with TypeScript (in src/vue/)
  {
    files: ['src/vue/**/*.vue'],
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.browser,
        fetch: 'readonly',
        console: 'readonly',
        URLSearchParams: 'readonly'
      }
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error', 'warn', 'log'] }],
      'prefer-const': 'error'
    }
  },

  // Vue files without TypeScript
  {
    files: ['**/*.vue'],
    ignores: ['src/vue/**/*.vue'],
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: {
          ...globals.browser,
          ...globals.node
        }
      }
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
];
