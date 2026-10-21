<?php
/**
 * Guards against an incompatible psr/http-message at bootstrap.
 *
 * guzzlehttp/psr7 3.x declares `withScheme(string $scheme): UriInterface` and
 * requires psr/http-message >= 2.0. When an older 1.0.x copy of that interface
 * wins the autoload race (a stale vendor tree, or a distribution package
 * reachable through include_path such as /usr/share/php), PHP aborts the first
 * time GuzzleHttp\Psr7\Uri is loaded with a compile-time fatal that names
 * neither the offending file nor a remedy:
 *
 *   Declaration of GuzzleHttp\Psr7\Uri::withScheme(string $scheme):
 *   Psr\Http\Message\UriInterface must be compatible with
 *   Psr\Http\Message\UriInterface::withScheme($scheme)
 *
 * The interface signature is inspected up front so that this becomes an
 * actionable message naming the file that was actually loaded. psr7 2.x also
 * declares an untyped withScheme() and works with psr/http-message 1.0.x, so
 * the bundled implementation is checked before reporting a problem.
 */
final class Psr7Compat {
	private const URI_INTERFACE = 'Psr\Http\Message\UriInterface';

	private function __construct() {}

	/**
	 * @return string|null problem description, or null when the loaded interface is usable
	 */
	public static function check(): ?string {
		if (!interface_exists(self::URI_INTERFACE))
			return null;

		$method = new \ReflectionMethod(self::URI_INTERFACE, 'withScheme');
		$param = $method->getParameters()[0] ?? null;

		// psr/http-message >= 1.1 types the parameter, which every psr7 release accepts.
		if ($param === null || $param->hasType())
			return null;

		$uri_file = self::locate_uri();

		// No bundled psr7 to conflict with, or a 2.x one that accepts an untyped parameter.
		if ($uri_file === null || !self::requires_typed_param($uri_file))
			return null;

		$loaded_from = (new \ReflectionClass(self::URI_INTERFACE))->getFileName();

		return "Incompatible " . self::URI_INTERFACE . " loaded from " . ($loaded_from ?: '(unknown file)') .
			": withScheme() has no parameter type, so psr/http-message 1.0.x is in use, but the bundled " .
			"guzzlehttp/psr7 requires psr/http-message >= 2.0 and cannot be loaded. " .
			"Run 'composer install' to rebuild vendor/, and make sure no other copy of psr/http-message " .
			"is autoloaded before vendor/ (for example a distribution package installed under " .
			"include_path, such as /usr/share/php).";
	}

	/** @return string|null path to the psr7 Uri implementation, if one is installed */
	private static function locate_uri(): ?string {
		if (!class_exists('Composer\\InstalledVersions') ||
				!Composer\InstalledVersions::isInstalled('guzzlehttp/psr7'))
			return null;

		$dir = Composer\InstalledVersions::getInstallPath('guzzlehttp/psr7');

		return $dir !== null ? $dir . '/src/Uri.php' : null;
	}

	/**
	 * Whether the psr7 Uri implementation types its withScheme() parameter.
	 *
	 * The file is read rather than loaded: loading it is what raises the fatal.
	 * An unreadable or unparsable file reports no problem, so a failed check
	 * cannot block an install that would otherwise work.
	 */
	private static function requires_typed_param(string $uri_file): bool {
		$source = @file_get_contents($uri_file);

		if ($source === false)
			return false;

		return preg_match('/function\s+withScheme\s*\(\s*\??\\\\?string\s+\$/i', $source) === 1;
	}
}
