/**
 * Vite Configuration for Tiny Tiny RSS
 * 
 * This configuration enables Vite to work alongside the existing Dojo build system.
 * It provides:
 * - AMD module support via pre-bundling
 * - Dev server with HMR for faster development
 * - Proxy to PHP backend for API calls
 * - Asset handling for CSS, fonts, and images
 * - Vue 3 + Vuetify support for new UI components
 * 
 * The old build system remains functional as a fallback.
 */

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Project root (where index.html is located)
  root: '.',

  // Disable publicDir since js/ contains modules that are part of the module graph
  // Static assets are handled through explicit imports and Vite's asset pipeline
  publicDir: false,
  
  // Plugins
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  
  // Build configuration
  build: {
    // Output directory for production builds
    outDir: 'dist',
    
    // Empty outDir before build
    emptyOutDir: true,
    
    // Rollup options for better AMD handling
    rollupOptions: {
      // Entry point for the application
      input: path.resolve(__dirname, 'js/index.html'),
      
      // Keep the existing directory structure for compatibility
      preserveEntrySignatures: 'allow-empty',
      
      // External dependencies that should not be bundled
      external: [],
      
      output: {
        // Preserve module structure
        preserveModules: false,
        
        // Asset file naming
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },

  // Resolve configuration for module aliases
  resolve: {
    alias: {
      // Dojo module aliases - point to the existing Dojo AMD modules
      'dojo': path.resolve(__dirname, 'lib/dojo'),
      'dijit': path.resolve(__dirname, 'lib/dijit'),
      'fox': path.resolve(__dirname, 'js'),
      
      // Legacy module paths
      'lib': path.resolve(__dirname, 'lib'),
      
      // Vue 3 aliases
      '@': path.resolve(__dirname, 'src/vue'),
      '@/components': path.resolve(__dirname, 'src/vue/components'),
      '@/composables': path.resolve(__dirname, 'src/vue/composables'),
      '@/types': path.resolve(__dirname, 'src/vue/types'),
    },
    
    // File extensions to try when resolving imports
    extensions: ['.js', '.ts', '.vue', '.json', '.html', '.htm'],
  },
  
  // Pre-bundling configuration for AMD modules
  // This converts Dojo AMD modules to ESM for Vite's dependency pre-bundling
  optimizeDeps: {
    // Entries to pre-bundle
    entries: [
      // Main application entry point
      'js/tt-rss.js',
      // Common utilities
      'js/common.js',
      // Vue app entry
      'src/vue/main.ts',
    ],
    
    // Force inclusion of Dojo modules for pre-bundling
    // Note: Only modules that actually exist will be pre-bundled
    // These are defined in lib/dojo/*.js files
    include: [
      // Core Dojo modules (from lib/dojo/)
      'dojo/_base/kernel',
      'dojo/_base/declare',
      'dojo/_base/lang',
      'dojo/_base/array',
      'dojo/_base/connect',
      'dojo/_base/html',
      'dojo/_base/url',
      'dojo/_base/config',
      'dojo/_base/loader',
      'dojo/_base/browser',
      'dojo/_base/window',
      'dojo/ready',
      'dojo/parser',
      'dojo/sniff',
      'dojo/dom',
      'dojo/dom-construct',
      'dojo/dom-class',
      'dojo/dom-attr',
      'dojo/dom-style',
      'dojo/dom-prop',
      'dojo/dom-form',
      'dojo/dom-geometry',
      'dojo/query',
      'dojo/json',
      'dojo/string',
      'dojo/hash',
      'dojo/cookie',
      'dojo/window',
      'dojo/on',
      'dojo/topic',
      'dojo/when',
      'dojo/Deferred',
      'dojo/promise/Promise',
      'dojo/Stateful',
      'dojo/text',
      'dojo/cache',
      'dojo/i18n',
      'dojo/request',
      'dojo/keys',
      'dojo/mouse',
      'dojo/touch',
      'dojo/uacss',
      'dojo/hccss',
      'dojo/html',
      'dojo/node',
      'dojo/has',
      'dojo/fx',
      'dojo/colors',
      'dojo/number',
      'dojo/currency',
      'dojo/date/stamp',
      'dojo/date/locale',
      'dojo/io-query',
      'dojo/json5',
      'dojo/back',
      'dojo/aspect',
      'dojo/AdapterRegistry',
      'dojo/Evented',
      'dojo/DeferredList',
      'dojo/NodeList',
      'dojo/NodeList-dom',
      'dojo/NodeList-data',
      'dojo/NodeList-manipulate',
      'dojo/NodeList-traverse',
      'dojo/NodeList-html',
      'dojo/NodeList-fx',
      'dojo/router',
      'dojo/behavior',
      'dojo/debounce',
      'dojo/throttle',
      'dojo/regexp',
      'dojo/global',
      'dojo/request/default',
      'dojo/request/xhr',
      'dojo/data/ItemFileWriteStore',
      'dojo/data/ItemFileReadStore',
      'dojo/store/Memory',
      'dojo/store/api/Store',
      'dojo/store/util/QueryResults',
      'dojo/store/util/SimpleQueryEngine',
      'dojo/dnd/Moveable',
      'dojo/dnd/Mover',
      'dojo/dnd/TimedMoveable',
      'dojo/dnd/move',
      'dojo/dnd/common',
      'dojo/dnd/Selector',
      'dojo/dnd/Source',
      'dojo/dnd/autoscroll',
      'dojo/dnd/Avatar',
      'dojo/dnd/Manager',
      'dojo/store/Observable',
      
      // Vuetify
      'vuetify',
    ],
    
    // Exclude patterns - Dojo should be pre-bundled, not excluded
    exclude: [],
  },
  
  // Dev server configuration
  server: {
    // Port for the dev server
    port: 5173,

    // Bind to loopback by default for security
    // Use --host flag to bind to all interfaces if needed
    host: '127.0.0.1',

    // Open browser on start
    open: false,
    
    // Proxy configuration for PHP backend
    proxy: {
      // Proxy API calls to backend.php
      '/backend.php': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      // Proxy public.php
      '/public.php': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      // Proxy API endpoint
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      // Proxy static assets
      '/cache': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      // Proxy images
      '/images': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      // Proxy themes
      '/themes': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
    
    // Watch for file changes
    watch: {
      usePolling: true,
      interval: 100,
    },
    
    // HMR settings
    hmr: {
      // Enable HMR
      overlay: true,
    },
  },
  
  // CSS configuration
  css: {
    // CSS preprocessor options
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        // Add paths for Less imports
        paths: [
          path.resolve(__dirname, 'themes'),
          path.resolve(__dirname, 'themes/light'),
          path.resolve(__dirname, 'themes/night'),
          path.resolve(__dirname, 'lib/dijit/themes'),
        ],
      },
    },
  },
  
  // Worker configuration
  worker: {
    format: 'es',
  },
  
  // Assets configuration
  assetsInclude: [
    // Support various template and data formats
    '**/*.html',
    '**/*.htm',
    '**/*.txt',
    '**/*.json',
    
    // Font files
    '**/*.eot',
    '**/*.woff',
    '**/*.woff2',
    '**/*.ttf',
    '**/*.otf',
    '**/*.svg',
    
    // Image formats
    '**/*.gif',
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.webp',
    '**/*.ico',
    
    // XML (for feeds and config)
    '**/*.xml',
  ],
  
  // Define global constants
  define: {
    // Make __dirname available for legacy code
    __dirname: JSON.stringify(__dirname),
  },
  
  // Legacy Vite options for compatibility
  esbuild: {
    // Target for JS transpilation
    target: 'es2015',
    
    // Supported browserslist
    supported: {
      'top-level-await': true,
    },
  },
});
