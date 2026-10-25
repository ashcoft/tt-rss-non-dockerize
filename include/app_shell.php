<?php
	/**
	 * Shared HTML shell for the Vite/Vue/Vuetify client.
	 *
	 * index.php and prefs.php both render this shell: it exists to inject the
	 * session CSRF token, the user's theme and per-plugin CSS, which the static
	 * Vite build cannot know about. Everything else is the built client.
	 *
	 * Expects `$ttrss_view` ("main" or "preferences") and optional
	 * `$ttrss_prefs_tab` to be set by the entry point before including this
	 * file. Authentication has already been checked by login_sequence().
	 */

	$theme = null;
	if ($_SESSION["uid"] && empty($_SESSION["safe_mode"])) {
		$theme = Prefs::get(Prefs::USER_CSS_THEME, $_SESSION['uid'], $_SESSION['profile'] ?? null);
		if ($theme && !theme_exists("$theme")) {
			$theme = null;
		}
	}
?>
<!DOCTYPE html>
<html>
<head>
	<title>Tiny Tiny RSS</title>
	<meta name="viewport" content="initial-scale=1,width=device-width" />

	<?php if ($theme) echo stylesheet_tag(get_theme_path($theme), ['id' => 'theme_css']); ?>

	<?= Config::get_override_links() ?>

	<script type="text/javascript">
		const __csrf_token = "<?= $_SESSION["csrf_token"]; ?>";
		const __ttrss_user = <?= json_encode((string)($_SESSION["name"] ?? "")) ?>;
		const __ttrss_view = <?= json_encode($ttrss_view ?? "main") ?>;
		const __ttrss_prefs_tab = <?= json_encode($ttrss_prefs_tab ?? "") ?>;

		const __default_light_theme = "<?= get_theme_path(Config::get(Config::DEFAULT_LIGHT_THEME), 'themes/light.css') ?>";
		const __default_dark_theme = "<?= get_theme_path(Config::get(Config::DEFAULT_DARK_THEME), 'themes/night.css') ?>";
	</script>

	<?php UserHelper::print_user_stylesheet() ?>

	<style type="text/css">
	<?php
		foreach (PluginHost::getInstance()->get_plugins() as $p) {
			$css = ($ttrss_view ?? "main") === "preferences" ? $p->get_prefs_css() : $p->get_css();
			if ($css) {
				echo $css;
			}
		}
	?>
	</style>

	<link rel="shortcut icon" type="image/png" href="images/favicon.png"/>
	<link rel="icon" type="image/png" sizes="72x72" href="images/favicon-72px.png" />

	<!-- Progressive Web App: installable, launches standalone on mobile. -->
	<link rel="manifest" href="manifest.webmanifest"/>
	<meta name="theme-color" content="#257aa7" media="(prefers-color-scheme: light)"/>
	<meta name="theme-color" content="#303030" media="(prefers-color-scheme: dark)"/>
	<link rel="apple-touch-icon" href="images/icon-192.png"/>
	<meta name="apple-mobile-web-app-capable" content="yes"/>
	<meta name="mobile-web-app-capable" content="yes"/>
	<meta name="apple-mobile-web-app-status-bar-style" content="default"/>
	<meta name="apple-mobile-web-app-title" content="Tiny Tiny RSS"/>
	<meta name="referrer" content="no-referrer"/>

	<?= ViteAssets::head_html() ?>

	<style type="text/css">
		body.css_loading #vue-app {
			visibility : hidden;
		}
	</style>
</head>

<body class="flat ttrss_main ttrss_index css_loading">

<noscript class="alert alert-error"><?= __('Javascript is disabled. Please enable it.') ?></noscript>

<div id="vue-app"></div>

<?= ViteAssets::body_html() ?>

</body>
</html>
