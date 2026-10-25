/**
 * Vite Configuration for Tiny Tiny RSS
 *
 * This builds the production client loaded by the PHP shell
 * (include/app_shell.php via classes/ViteAssets.php):
 * - Vue + Vuetify dependency optimization
 * - Dev server with HMR for development against the PHP backend
 * - Proxy to PHP backend for API calls
 * - Manifest output so PHP can emit the entry script/style tags
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

  // Static assets are handled through explicit imports and Vite's asset pipeline.
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

    // classes/ViteAssets.php reads dist/.vite/manifest.json to emit the tags
    // for the PHP shell (the shell cannot be the Vite HTML entry because it
    // embeds the session CSRF token and the user's theme).
    manifest: true,

    // Transpile target: Vuetify 4 emits destructuring that esbuild's default
    // target cannot rewrite, so target a modern baseline
    target: 'es2022',
    
    // Empty outDir before build
    emptyOutDir: true,
    
    // Rollup options for better AMD handling
    rollupOptions: {
      // Entry point for the application
      input: path.resolve(__dirname, 'src/vue/index.html'),
      
      // Keep the existing directory structure for compatibility.
      // Entries without exports are allowed; rolldown (Vite 8) only accepts
      // 'exports-only' | 'strict' | 'allow-extension' | false.
      preserveEntrySignatures: false,
      
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
      // Vue 3 aliases (no Dojo/dijit aliases: the client no longer imports
      // AMD modules; the legacy files stay on disk for plugins only).
      '@': path.resolve(__dirname, 'src/vue'),
      '@/components': path.resolve(__dirname, 'src/vue/components'),
      '@/composables': path.resolve(__dirname, 'src/vue/composables'),
      '@/types': path.resolve(__dirname, 'src/vue/types'),
    },
    
    // File extensions to try when resolving imports
    extensions: ['.js', '.ts', '.vue', '.json', '.html', '.htm'],
  },
  
  // Only optimize the Vue module graph. Vite does not convert Dojo AMD to ESM.
  optimizeDeps: {
    entries: ['src/vue/main.ts'],
    include: ['vue', 'pinia', 'vuetify'],
    esbuildOptions: { target: 'es2022' },
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
      // The PHP shell (index.php/prefs.php) is where the Vue client reads the
      // session CSRF token from, so it must be forwarded too.
      '/index.php': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
      '/prefs.php': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path,
      },
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
    // (HTML is intentionally not listed: the Vue app entry must be
    // processed by Vite's HTML pipeline, not treated as a static asset.)
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
    target: 'es2022',
    
    // Supported browserslist
    supported: {
      'top-level-await': true,
    },
  },
});
