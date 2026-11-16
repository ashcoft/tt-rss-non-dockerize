<?php
	// See index.php: PHP's default session cache limiter would send no-store,
	// which costs this page the back/forward cache for no benefit it needs.
	session_cache_limiter('');

	require_once __DIR__ . '/include/autoload.php';
	require_once __DIR__ . '/include/sessions.php';
	require_once __DIR__ . '/include/vue_assets.php';

	Config::sanity_check();

	if (!init_plugins()) return;

	UserHelper::login_sequence();

        // Preferences serve the Vue shell: the app opens its preferences dialog
        // on mount (see __open_preferences in include/vue_shell.php). A
        // production build is required (pnpm run build).
        VueAssets::serve_vue_shell(true);
