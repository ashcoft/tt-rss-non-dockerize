<?php
	// Opt out of PHP's session cache limiter before include/sessions.php starts
	// the session.  Its default ('nocache') stamps this page with 'no-store,
	// no-cache, must-revalidate', and no-store disqualifies the document from the
	// back/forward cache, so navigating back re-boots the entire client instead
	// of restoring it.  Scoped to this entry point on purpose: the API handlers
	// share the session machinery but not these requirements.
	session_cache_limiter('');

	require_once __DIR__ . '/include/autoload.php';
	require_once __DIR__ . '/include/sessions.php';

	Config::sanity_check();

	if (!init_plugins()) return;

	UserHelper::login_sequence();

	header('Content-Type: text/html; charset=utf-8');

	// What the shell actually requires: it embeds this session's CSRF token, the
	// user's theme, and per-plugin CSS, so no shared cache may store it and it
	// must be revalidated before reuse.  no-store would add only "never write it
	// to disk", which would guard the CSRF token while leaving the session
	// cookie that token is bound to in the cookie store regardless.
	header('Cache-Control: private, no-cache');

	// The Vue client renders the preferences view in the same shell; legacy
	// links use either `?view=preferences` or the old `?tab=` parameter.
	$ttrss_view = "main";
	$ttrss_prefs_tab = "";

	if (($_GET["view"] ?? "") === "preferences" || !empty($_GET["tab"])) {
		$ttrss_view = "preferences";
		$ttrss_prefs_tab = clean($_GET["tab"] ?? "");
	}

	// Buffered so sendConditionalHtml() can hash it into a validator;
	// unauthenticated requests never reach here, login_sequence() renders the
	// login form and exits.
	ob_start();

	require __DIR__ . '/include/app_shell.php';

	sendConditionalHtml((string) ob_get_clean());
