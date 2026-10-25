<?php
	// See index.php: PHP's default session cache limiter would send no-store,
	// which costs this page the back/forward cache for no benefit it needs.
	session_cache_limiter('');

	require_once __DIR__ . '/include/autoload.php';
	require_once __DIR__ . '/include/sessions.php';

	Config::sanity_check();

	if (!init_plugins()) return;

	UserHelper::login_sequence();

	header('Content-Type: text/html; charset=utf-8');
	header('Cache-Control: private, no-cache');

	// Preferences are a view of the same Vue client. Keeping this entry point
	// means existing plugin and bookmark links (including the legacy `?tab=`
	// values) keep working without loading the Dojo preferences page.
	$ttrss_view = "preferences";
	$ttrss_prefs_tab = clean($_GET["tab"] ?? "");

	ob_start();

	require __DIR__ . '/include/app_shell.php';

	sendConditionalHtml((string) ob_get_clean());
