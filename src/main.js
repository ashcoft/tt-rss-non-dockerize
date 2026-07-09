/**
 * Main entry point for the Vite development server
 * 
 * This module initializes the AMD shim and loads the Dojo modules
 * in the correct order to ensure proper module resolution.
 */

import './shim/amd-shim.js';

// Load the common utilities first (non-Dojo, synchronous)
import '/js/common.js';

// Load the main Dojo application
import '/js/tt-rss.js';
