<?php
/**
 * Vue shell for Tiny Tiny RSS.
 *
 * Rendered by index.php when a production build is present. It replaces the
 * Dojo/dijit markup that used to live inline in index.php: the widget tree,
 * the AMD loader bootstrap and the Dojo-specific plugin hooks are gone, and the
 * Vue bundle owns the DOM from #vue-app down.
 *
 * What PHP still provides here is everything the client cannot compute:
 *   - the session CSRF token the adapter sends with every backend.php call
 *   - the user's theme and per-user/per-plugin stylesheets
 *   - the login form when there is no session (the Vue app renders its own
 *     once authenticated, but an unauthenticated shell must still be served)
 *   - the PWA manifest and icons
 */

/** @var string $csrf_token */
/** @var bool $authenticated */
?>
<!DOCTYPE html>
<html>
<head>
        <title>Tiny Tiny RSS</title>
        <meta name="viewport" content="initial-scale=1,width=device-width" />

        <?php if ($authenticated && empty($_SESSION["safe_mode"])) {
                $theme = Prefs::get(Prefs::USER_CSS_THEME, $_SESSION['uid'], $_SESSION['profile'] ?? null);
                if ($theme && theme_exists("$theme")) {
                        echo stylesheet_tag(get_theme_path($theme), ['id' => 'theme_css']);
                }
        } ?>

        <?= Config::get_override_links() ?>

        <script type="text/javascript">
                const __csrf_token = "<?= $csrf_token ?>";

                const __default_light_theme = "<?= get_theme_path(Config::get(Config::DEFAULT_LIGHT_THEME), 'themes/light.css') ?>";
                const __default_dark_theme = "<?= get_theme_path(Config::get(Config::DEFAULT_DARK_THEME), 'themes/night.css') ?>";
        </script>

	<?php if ($authenticated) UserHelper::print_user_stylesheet() ?>

        <?php if ($authenticated) { ?>
        <style type="text/css">
        <?php
                foreach (PluginHost::getInstance()->get_plugins() as $p) {
                        $css = $p->get_css();
                        if ($css) {
                                echo $css;
                        }
                }
        ?>
        </style>
        <?php } ?>

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

        <?= VueAssets::tags() ?>

        <style type="text/css">
                @media (prefers-color-scheme: dark) {
                        body {
                                background : #303030;
                        }
                }
        </style>

        <noscript>
                <?= stylesheet_tag("themes/light.css") ?>
                <p style="margin : 16px">
                        <?= __('Javascript is disabled. Please enable it.') ?>
                </p>
        </noscript>

        <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
        <meta name="referrer" content="no-referrer"/>
</head>

<body class="flat ttrss_main ttrss_index">
<?php if (!$authenticated) {
        // login_sequence() was called with $render_login_form = false, so the
        // Vue app is responsible for the login UI. It calls
        // public.php?op=login and re-reads the CSRF token on success.
        ?>
        <noscript class="alert alert-error"><?= __('Javascript is disabled. Please enable it.') ?></noscript>
<?php } ?>

<div id="vue-app"></div>

<?php
        // Plugin JS that used to run under Dojo. It is still emitted for the
        // plugins that ship it, guarded so a failure cannot break the app.
        if ($authenticated) {
        foreach (PluginHost::getInstance()->get_plugins() as $n => $p) {
                $script = $p->get_js();

                if ($script) {
                        echo "<script type='text/javascript'>try {\n$script\n} catch (e) {\n"
                                . "console.warn('failed to initialize plugin JS: " . $n . "', e);\n}</script>";
                }
        }
        }
?>
</body>
</html>
