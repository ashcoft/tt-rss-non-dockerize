<?php
/**
 * Helpers for serving the Vite-built Vue application from PHP entry points.
 *
 * The build is produced by `pnpm run build` into `dist/`, with hashed asset
 * names recorded in `dist/.vite/manifest.json`. These helpers resolve the entry
 * tags so index.php/prefs.php do not have to hardcode hashes.
 */
class VueAssets {
        public const BUILD_DIR = 'dist';
        /** Derived from BUILD_DIR so the two cannot drift apart. */
        public const MANIFEST = self::BUILD_DIR . '/.vite/manifest.json';
        public const ENTRY = 'src/vue/index.html';
        /** The preferences app is a second HTML entry in the same build. */
        public const PREFS_ENTRY = 'src/vue/prefs.html';

        /** @var array<string, array<string, mixed>>|null */
        private static ?array $manifest = null;

        /**
         * The decoded manifest, cached. An empty array means "no usable build".
         *
         * @return array<string, array<string, mixed>>
         */
        private static function manifest(): array {
                if (self::$manifest === null) {
                        self::$manifest = self::load_manifest();
                }

                return self::$manifest;
        }

        /**
         * Read and decode the build manifest, returning an empty array when the
         * build is missing or malformed (both mean "serve the legacy shell").
         *
         * @return array<string, array<string, mixed>>
         */
        private static function load_manifest(): array {
                $path = dirname(__DIR__) . '/' . self::MANIFEST;

                if (is_file($path) === false) {
                        return [];
                }

                $decoded = json_decode((string)file_get_contents($path), true);

                return is_array($decoded) === true ? $decoded : [];
        }

        /** Whether a production build is present and usable. */
        public static function is_built(): bool {
                return self::entry(self::ENTRY) !== null;
        }

        /** Whether the preferences entry is present in the build. */
        public static function is_prefs_built(): bool {
                return self::entry(self::PREFS_ENTRY) !== null;
        }

        /** @return array<string, mixed>|null */
        private static function entry(string $key = self::ENTRY): ?array {
                return self::manifest()[$key] ?? null;
        }

        /**
         * Render the Vue shell and finish the response.
         *
         * Emits the same cache headers as the Dojo shell: the page embeds this
         * session's CSRF token and stylesheets, so it must not be stored by a
         * shared cache but should stay eligible for the back/forward cache.
         *
         * @param bool $prefs serve the preferences app instead of the reader
         */
        public static function serve_vue_shell(bool $prefs = false): void {
                header('Content-Type: text/html; charset=utf-8');
                header('Cache-Control: private, no-cache');

                $authenticated = !empty($_SESSION['uid']);

                // The Vue client reads this from the global, and the adapter also
                // falls back to parsing the page when the global is missing.
                $csrf_token = $_SESSION['csrf_token'] ?? '';

                $entry = $prefs ? self::PREFS_ENTRY : self::ENTRY;

                ob_start();
                require __DIR__ . '/vue_shell.php';
                $html = (string)ob_get_clean();

                sendConditionalHtml($html);
        }

        /** Absolute filesystem path for a manifest-relative asset. */
        private static function asset_path(string $file): string {
                return dirname(__DIR__) . '/' . self::BUILD_DIR . '/' . $file;
        }

        /**
         * `<script type="module">` and stylesheet tags for the built entry.
         *
         * The stylesheet is emitted before the script so the page does not flash
         * unstyled content while the module graph loads.
         *
         * @param string $entryKey manifest key of the HTML entry to emit
         */
        public static function tags(string $entryKey = self::ENTRY): string {
                $entry = self::entry($entryKey);

                if ($entry === null) {
                        return '';
                }

                $out = '';

                foreach ((array)($entry['css'] ?? []) as $css) {
                        if (is_file(self::asset_path((string)$css)) === true) {
                                $out .= stylesheet_tag(self::BUILD_DIR . '/' . $css);
                        }
                }

                if (isset($entry['file']) === true) {
                        $out .= '<script type="module" src="'
                                . htmlspecialchars(self::BUILD_DIR . '/' . $entry['file'], ENT_QUOTES, 'UTF-8')
                                . '"></script>';
                }

                return $out;
        }
}
