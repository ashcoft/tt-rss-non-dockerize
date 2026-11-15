<?php
	// Opt out of PHP's session cache limiter before include/sessions.php starts
	// the session. Its default ('nocache') stamps this page with 'no-store,
	// no-cache, must-revalidate', and no-store disqualifies the document from the
	// back/forward cache, so navigating back re-boots the entire client instead
	// of restoring it. Scoped to this entry point on purpose: the API handlers
	// share the session machinery but not these requirements.
	session_cache_limiter('');

	require_once __DIR__ . '/include/autoload.php';
	require_once __DIR__ . '/include/sessions.php';
	require_once __DIR__ . '/include/vue_assets.php';

	Config::sanity_check();

	if (!init_plugins()) return;

	// The Vue build is the only client now; there is no Dojo shell to fall back
	// to. login_sequence() renders the login form itself only when the build is
	// missing, which should never happen in a deployed instance.
	$vue_build = VueAssets::is_built();

	UserHelper::login_sequence($vue_build === false);

	if ($vue_build === true) {
		VueAssets::serve_vue_shell();
		return;
	}

	// No production build: the app cannot run, so say so plainly instead of
	// serving a broken page.
	header('Content-Type: text/html; charset=utf-8');
	print_error(__('The application build is missing. Run "pnpm run build" and reload this page.'));
