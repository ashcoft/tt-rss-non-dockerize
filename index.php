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
        require_once __DIR__ . '/include/vue_assets.php';

        Config::sanity_check();

        if (!init_plugins()) return;

        // The Vue app is the only front-end now: the Dojo shell that used to
        // live here is gone, along with lib/dojo, lib/dijit and the js/*.js AMD
        // modules. serve_vue_shell() renders the shell, which the built bundle
        // takes over from #vue-app down. A production build is required; run
        // `pnpm run build` (VueAssets::is_built() checks dist/.vite/manifest.json).
        // false: the Vue app renders the login UI itself.
        UserHelper::login_sequence(false);

        VueAssets::serve_vue_shell();
