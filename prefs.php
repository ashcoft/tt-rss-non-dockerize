<?php
	// See index.php: PHP's default session cache limiter would send no-store,
	// which costs this page the back/forward cache for no benefit it needs.
	session_cache_limiter('');

	require_once __DIR__ . '/include/autoload.php';
	require_once __DIR__ . '/include/sessions.php';
	require_once __DIR__ . '/include/vue_assets.php';

	Config::sanity_check();

	if (!init_plugins()) return;

	// The Vue preferences build is the only client now; there is no Dojo shell to
	// fall back to.
	$vue_build = VueAssets::is_prefs_built();

	UserHelper::login_sequence($vue_build === false);

	if ($vue_build === true) {
		VueAssets::serve_vue_shell(true);
		return;
	}

	header('Content-Type: text/html; charset=utf-8');
	print_error(__('The preferences build is missing. Run "pnpm run build" and reload this page.'));
