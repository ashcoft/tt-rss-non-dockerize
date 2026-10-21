<?php
/**
 * Guards against an incompatible psr/http-message at bootstrap.
 *
 * guzzlehttp/psr7 3.x declares `withScheme(string $scheme): UriInterface` and
 * requires psr/http-message >= 2.0. When an older copy of that interface wins
 * the autoload race (a stale vendor tree, or a distribution package reachable
 * through include_path such as /usr/share/php), PHP aborts the first time
 * GuzzleHttp\Psr7\Uri is loaded with a compile-time fatal that names neither
 * the offending file nor a remedy:
 *
 *   Declaration of GuzzleHttp\Psr7\Uri::withScheme(string $scheme):
 *   Psr\Http\Message\UriInterface must be compatible with
 *   Psr\Http\Message\UriInterface::withScheme($scheme)
 *
 * The loaded interface is compared against the bundled implementation up front
 * so that this becomes an actionable message naming the file that was loaded.
 * psr7 2.x declares an untyped withScheme() and is valid alongside any
 * psr/http-message, so the bundled implementation is inspected first.
 *
 * Called from Config::sanity_check(), which reports the problem through the
 * usual startup-failure path for both web and CLI entrypoints.
 */
final class Psr7Compat {
	private const URI_INTERFACE = 'Psr\\Http\\Message\\UriInterface';

	private const URI_IMPLEMENTATION = 'guzzlehttp/psr7';

	/**
	 * This class only exposes static methods.
	 */
	private function __construct() {
	}

	/**
	 * @return string|null problem description, or null when the loaded interface is usable
	 */
	public static function check(): ?string {
		if (interface_exists(self::URI_INTERFACE) === false) {
			return null;
		}

		if (self::isCompatible() === true) {
			return null;
		}

		$loadedFrom = (new \ReflectionClass(self::URI_INTERFACE))->getFileName();

		return "Incompatible " . self::URI_INTERFACE . " loaded from " . self::describePath($loadedFrom) .
			": withScheme() must declare a non-nullable string parameter to be satisfied by the bundled " .
			"guzzlehttp/psr7, which requires psr/http-message >= 2.0. " .
			"Run 'composer install' to rebuild vendor/, and make sure no other copy of psr/http-message " .
			"is autoloaded before vendor/ (for example a distribution package installed under " .
			"include_path, such as /usr/share/php).";
	}

	/**
	 * Whether the loaded interface can be implemented by the bundled psr7.
	 *
	 * The cheap reflection test runs first, so a healthy install does no file
	 * I/O. psr7 2.x declares an untyped withScheme() and accepts anything, so
	 * the bundled implementation is only consulted once the interface looks
	 * typed.
	 */
	private static function isCompatible(): bool {
		$method = new \ReflectionMethod(self::URI_INTERFACE, 'withScheme');

		if (self::acceptsStringParam($method) === true) {
			return true;
		}

		$uriFile = self::locateUri();

		return $uriFile === null || self::declaresStringParam($uriFile) === false;
	}

	/**
	 * Whether the interface parameter can be satisfied by `withScheme(string $scheme)`.
	 *
	 * An implementation may only widen a parameter relative to its interface, so
	 * the interface has to accept exactly one required, non-nullable string: an
	 * untyped or `mixed` parameter is wider and rejected, `?string`, a union, or
	 * an intersection cannot be satisfied by an implementation that rejects null
	 * and non-strings, and an optional or absent parameter allows callers to omit
	 * an argument the implementation requires.
	 */
	private static function acceptsStringParam(\ReflectionMethod $method): bool {
		$param = $method->getParameters()[0] ?? null;

		if ($param === null || $param->isOptional() === true) {
			return false;
		}

		$type = $param->getType();

		return $type instanceof \ReflectionNamedType
			&& $type->getName() === 'string'
			&& $type->allowsNull() === false;
	}

	/** @param string|false $path value returned by ReflectionClass::getFileName() */
	private static function describePath(string|false $path): string {
		return $path === false || $path === '' ? '(unknown file)' : $path;
	}

	/** @return string|null path to the psr7 Uri implementation, if one is installed */
	private static function locateUri(): ?string {
		if (class_exists('Composer\\InstalledVersions') === false ||
				Composer\InstalledVersions::isInstalled(self::URI_IMPLEMENTATION) === false) {
			return null;
		}

		$dir = Composer\InstalledVersions::getInstallPath(self::URI_IMPLEMENTATION);

		return $dir !== null ? $dir . '/src/Uri.php' : null;
	}

	/**
	 * Whether the psr7 Uri implementation types its withScheme() parameter as string.
	 *
	 * The file is read rather than loaded, because loading it is what raises the
	 * fatal. An unreadable file reports no problem, so a failed check cannot block
	 * an install that would otherwise work.
	 */
	private static function declaresStringParam(string $uriFile): bool {
		if (is_readable($uriFile) === false) {
			return false;
		}

		$source = file_get_contents($uriFile);

		if ($source === false) {
			return false;
		}

		return preg_match('/function\s+withScheme\s*\(\s*\\\\?string\s+\$/i', $source) === 1;
	}
}
