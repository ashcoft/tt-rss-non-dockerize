/**
 * AMD (Asynchronous Module Definition) Shim for Vite
 * 
 * This shim provides Dojo-compatible require/define globals that work
 * with Vite's module resolution. It translates Dojo module IDs to
 * paths that Vite can import.
 */

// Allowed module base directories for security
const ALLOWED_MODULE_PREFIXES = [
  'dojo/',
  'dijit/',
  'fox/',
  'dojox/',
  'lib/',     // maps to lib/ (dojo/dijit libs)
  'js/',      // maps to js/ (tt-rss app modules)
];

// Module cache for loaded modules
const moduleCache = new Map();

// Config for module paths
const config = {
  baseUrl: '',
  paths: {
    'dojo': 'lib/dojo',
    'dijit': 'lib/dijit',
    'fox': 'js',
    'dojox': 'lib/dojox',
  },
  packages: []
};

/**
 * Resolve a Dojo module ID to a file path
 * @param {string} moduleId - The Dojo module ID
 * @returns {string|null} - The resolved file path or null
 */
function resolveModuleId(moduleId) {
  // Skip absolute URLs and empty modules
  if (!moduleId || moduleId.startsWith('/') || moduleId.startsWith('http')) {
    return null;
  }

  // Handle relative modules (starting with ./ or ../)
  if (moduleId.startsWith('./') || moduleId.startsWith('../')) {
    return null; // Relative paths not supported in this context
  }

  // Try to match against configured paths
  for (const [prefix, path] of Object.entries(config.paths)) {
    if (moduleId.startsWith(prefix + '/') || moduleId === prefix) {
      const remainder = moduleId === prefix ? '' : moduleId.substring(prefix.length + 1);
      return `${path}/${remainder}`;
    }
  }

  // Check against allowed prefixes (modules without explicit path config)
  for (const prefix of ALLOWED_MODULE_PREFIXES) {
    if (moduleId.startsWith(prefix) || moduleId === prefix) {
      if (prefix === 'dojo/' || prefix === 'dijit/' || prefix === 'dojox/' || prefix === 'lib/') {
        return `lib/${moduleId}`;
      }
      if (prefix === 'fox/') {
        return `js/${moduleId}`;
      }
      if (prefix === 'js/') {
        const remainder = moduleId.substring(prefix.length);
        return `js/${remainder}`;
      }
    }
  }

  // Default: try as js/ module
  return `js/${moduleId}`;
}

/**
 * Validate that a resolved path is within allowed directories
 * @param {string} resolvedPath - The resolved file path
 * @returns {boolean} - Whether the path is allowed
 */
function isPathAllowed(resolvedPath) {
  if (!resolvedPath) return false;
  
  // Normalize path - remove any .. or . components
  const normalized = resolvedPath
    .split('/')
    .filter(part => part !== '.' && part !== '')
    .join('/');
  
  // Check if the normalized path starts with any allowed prefix
  for (const prefix of ALLOWED_MODULE_PREFIXES) {
    if (normalized.startsWith(prefix.replace(/\/$/, ''))) {
      return true;
    }
    // Also check explicit paths
    if (normalized.startsWith('lib/dojo') || 
        normalized.startsWith('lib/dijit') || 
        normalized.startsWith('lib/dojox') ||
        normalized.startsWith('js')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the module file path with extension
 * @param {string} resolvedPath - The resolved path without extension
 * @returns {string} - The path with appropriate extension
 */
function getModuleFile(resolvedPath) {
  // Try .js first, then no extension
  return resolvedPath.endsWith('.js') ? resolvedPath : `${resolvedPath}.js`;
}

/**
 * Load a module dynamically
 * @param {string} moduleId - The Dojo module ID
 * @returns {Promise<any>} - The loaded module
 */
async function loadModule(moduleId) {
  // Check cache first
  if (moduleCache.has(moduleId)) {
    return moduleCache.get(moduleId);
  }

  const resolvedPath = resolveModuleId(moduleId);
  
  if (!resolvedPath) {
    throw new Error(`Cannot resolve module: ${moduleId}`);
  }

  // SECURITY: Validate the resolved path is within allowed directories
  if (!isPathAllowed(resolvedPath)) {
    throw new Error(`Module path is not in allowed directories: ${resolvedPath}`);
  }

  const moduleFile = getModuleFile(resolvedPath);

  try {
    // Dynamic import with vite-ignore to prevent bundling
    const module = await import(/* @vite-ignore */ `/${moduleFile}`);
    
    // Cache the module
    moduleCache.set(moduleId, module.default || module);
    
    return module.default || module;
  } catch (error) {
    // Try without .js extension if it failed
    if (!resolvedPath.endsWith('.js')) {
      try {
        const module = await import(/* @vite-ignore */ `/${resolvedPath}.js`);
        moduleCache.set(moduleId, module.default || module);
        return module.default || module;
      } catch {
        // Module not found - re-throw original error with context
        throw new Error(`Failed to load module ${moduleId}: ${error.message}`, { cause: error });
      }
    }
    throw new Error(`Failed to load module ${moduleId}: ${error.message}`, { cause: error });
  }
}

/**
 * AMD define function
 * @param {string} [mid] - Module ID
 * @param {string[]} [deps] - Dependencies
 * @param {Function} factory - Factory function
 */
function define(mid, deps, factory) {
  // Handle different call signatures
  if (typeof mid === 'function') {
    factory = mid;
    deps = [];
    mid = null;
  } else if (Array.isArray(deps)) {
    // Normal case: define('mid', ['dep1', 'dep2'], factory)
  } else if (typeof deps === 'function') {
    factory = deps;
    deps = [];
  }

  // Store the definition for later require calls
  if (mid) {
    // Execute immediately if no deps
    if (deps && deps.length === 0) {
      const exports = {};
      const module = { exports };
      const result = factory.call(window, exports, module, {});
      moduleCache.set(mid, result || module.exports);
    } else if (deps && deps.length > 0) {
      // Need to load deps first
      Promise.all(deps.map(d => loadModule(d))).then(depModules => {
        const exports = {};
        const module = { exports };
        const result = factory.apply(window, depModules.concat([exports, module]));
        moduleCache.set(mid, result || module.exports);
      });
    } else {
      // No deps array, factory might be sync
      const exports = {};
      const module = { exports };
      const result = factory.call(window, exports, module, {});
      moduleCache.set(mid, result || module.exports);
    }
  }
}

// Ensure define is an object with proper properties
define.amd = { vendor: 'tt-rss-vite-shim' };

/**
 * AMD require function
 * @param {string[]} deps - Dependencies
 * @param {Function} callback - Callback function
 */
async function require(deps, callback) {
  try {
    const modules = await Promise.all(deps.map(d => loadModule(d)));
    if (callback) {
      callback.apply(window, modules);
    }
    return modules;
  } catch (error) {
    console.error('AMD require error:', error);
    throw error;
  }
}

// Expose globals
window.define = define;
window.require = require;

// Also expose for direct imports
export { define, require, resolveModuleId, isPathAllowed };
