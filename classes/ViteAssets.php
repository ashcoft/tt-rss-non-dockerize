<?php
/**
 * Locates the Vite-built frontend bundle for the PHP shell.
 *
 * The application pages are rendered by PHP (they have to embed the session
 * CSRF token and the user's theme), but the client itself is built by Vite.
 * This helper maps the build manifest to the `<script>`/`<link>` tags the
 * shell needs.
 *
 * In development, set TT_RSS_VITE_DEV_SERVER (for example
 * `http://127.0.0.1:5173`) and the shell loads the dev server instead of
 * `dist/`, which gives hot module replacement.
 */
class ViteAssets {
	private const MANIFEST = __DIR__ . '/../dist/.vite/manifest.json';
	private const ENTRY = 'src/vue/index.html';

	/** @var array<string, mixed>|null */
	private static ?array $manifest = null;

	private static bool $manifest_loaded = false;

	/** Vite dev server base URL, or null when serving a production build. */
	public static function dev_server(): ?string {
		$value = getenv('TT_RSS_VITE_DEV_SERVER');
		if (is_string($value) && trim($value) !== '') {
			return rtrim(trim($value), '/');
		}
		return null;
	}

	/**
	 * Tags that must be present in <head> (stylesheets and the HMR client).
	 */
	public static function head_html(): string {
		$dev = self::dev_server();

		if ($dev !== null) {
			return '<script type="module" src="' . htmlspecialchars($dev) . '/@vite/client"></script>' . "\n";
		}

		$entry = self::entry();
		if ($entry === null) {
			return '';
		}

		$html = '';
		foreach (self::string_list($entry['css'] ?? []) as $css) {
			$html .= '<link rel="stylesheet" href="' . htmlspecialchars(self::asset_url($css)) . '"/>' . "\n";
		}
		return $html;
	}

	/**
	 * Module tag that boots the application. Must be at the end of <body>.
	 */
	public static function body_html(): string {
		$dev = self::dev_server();

		if ($dev !== null) {
			return '<script type="module" src="' . htmlspecialchars($dev) . '/src/vue/main.ts"></script>' . "\n";
		}

		$entry = self::entry();
		if ($entry === null) {
			return '<div class="alert alert-error" style="margin:16px">'
				. 'The frontend bundle is missing. Run <code>pnpm install &amp;&amp; pnpm run build</code>.'
				. '</div>' . "\n";
		}

		return '<script type="module" src="' . htmlspecialchars(self::asset_url((string) $entry['file'])) . '"></script>' . "\n";
	}

	/**
	 * Whether a production build (or a dev server) is available.
	 */
	public static function available(): bool {
		return self::dev_server() !== null || self::entry() !== null;
	}

	/**
	 * @return array<string, mixed>|null
	 */
	private static function entry(): ?array {
		$manifest = self::manifest();
		if ($manifest === null) {
			return null;
		}

		$entry = $manifest[self::ENTRY] ?? null;
		if (is_array($entry) && isset($entry['file'])) {
			return $entry;
		}

		foreach ($manifest as $candidate) {
			if (is_array($candidate) && ($candidate['isEntry'] ?? false) && isset($candidate['file'])) {
				return $candidate;
			}
		}

		return null;
	}

	/**
	 * @return array<string, mixed>|null
	 */
	private static function manifest(): ?array {
		if (self::$manifest_loaded) {
			return self::$manifest;
		}

		self::$manifest_loaded = true;

		if (!is_file(self::MANIFEST)) {
			return null;
		}

		$raw = file_get_contents(self::MANIFEST);
		if ($raw === false) {
			return null;
		}

		$decoded = json_decode($raw, true);
		if (is_array($decoded)) {
			self::$manifest = $decoded;
		}

		return self::$manifest;
	}

	private static function asset_url(string $path): string {
		$file = __DIR__ . '/../dist/' . $path;
		$suffix = is_file($file) ? '?' . filemtime($file) : '';
		return 'dist/' . $path . $suffix;
	}

	/**
	 * @param mixed $value
	 * @return list<string>
	 */
	private static function string_list(mixed $value): array {
		if (!is_array($value)) {
			return [];
		}

		$result = [];
		foreach ($value as $entry) {
			if (is_string($entry)) {
				$result[] = $entry;
			}
		}
		return $result;
	}
}
