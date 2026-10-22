<?php
/**
 * Guards against an incompatible psr/http-message at bootstrap.
 *
 * guzzlehttp/psr7 3.x types the PSR-7 method signatures (for example
 * `withRequestTarget(string $requestTarget): RequestInterface` and
 * `withScheme(string $scheme): UriInterface`) and requires psr/http-message
 * >= 2.0. When an older 1.0.x copy wins the autoload race (a stale vendor
 * tree, or a distribution package reachable through include_path such as
 * /usr/share/php), PHP aborts the first time a psr7 class is loaded with a
 * compile-time fatal that names neither the offending file nor a remedy:
 *
 *   Declaration of GuzzleHttp\Psr7\Request::withRequestTarget(string $requestTarget):
 *   Psr\Http\Message\RequestInterface must be compatible with
 *   Psr\Http\Message\RequestInterface::withRequestTarget($requestTarget)
 *
 * check() loads the bundled interfaces first, so they win over a copy that
 * would otherwise be autoloaded later, and compares where each one came from.
 * A stale bundled copy is detected by reading the psr7 implementation (without
 * loading it, which is what raises the fatal) and checking the parameter type.
 *
 * Config::sanity_check() reports the problem through the normal startup path.
 * backend.php and api/index.php call check() directly because they do not run
 * sanity_check() and would otherwise raise the fatal before any output.
 */
final class Psr7Compat {
	/**
	 * PSR-7 interfaces used by the bundled psr7.
	 */
	private const INTERFACES = [
		'Psr\\Http\\Message\\MessageInterface',
		'Psr\\Http\\Message\\RequestInterface',
		'Psr\\Http\\Message\\ResponseInterface',
		'Psr\\Http\\Message\\ServerRequestInterface',
		'Psr\\Http\\Message\\StreamInterface',
		'Psr\\Http\\Message\\UploadedFileInterface',
		'Psr\\Http\\Message\\UriInterface',
	];

	/**
	 * Methods psr7 3.x narrows to a required, non-nullable string, mapped to the
	 * psr7 source file that declares them.
	 *
	 * @var array<string, array{0: string, 1: string}>
	 */
	private const TYPED_STRING_METHODS = [
		'Psr\\Http\\Message\\RequestInterface' => ['withRequestTarget', 'Request.php'],
		'Psr\\Http\\Message\\UriInterface' => ['withScheme', 'Uri.php'],
	];

	private const INTERFACE_PACKAGE = 'psr/http-message';

	private const IMPLEMENTATION_PACKAGE = 'guzzlehttp/psr7';

	/**
	 * This class only exposes static methods.
	 */
	private function __construct() {
	}

	/**
	 * @return string|null problem description, or null when the loaded interfaces are usable
	 */
	public static function check(): ?string {
		$interfaceDir = self::packageDir(self::INTERFACE_PACKAGE, '/src');
		$implementationDir = self::packageDir(self::IMPLEMENTATION_PACKAGE, '/src');

		// Without both packages there is no psr7 conflict to report; leave the
		// install alone so a failed check cannot block something that works.
		if ($interfaceDir === null || $implementationDir === null) {
			return null;
		}

		foreach (self::INTERFACES as $interface) {
			if (interface_exists($interface) === false) {
				continue;
			}

			$loadedFrom = (new \ReflectionClass($interface))->getFileName();

			if (self::isForeignCopy($interface, $loadedFrom, $interfaceDir) === true) {
				return self::foreignCopyMessage($interface, $loadedFrom, $interfaceDir);
			}

			$typedMethod = self::TYPED_STRING_METHODS[$interface] ?? null;

			if ($typedMethod === null) {
				continue;
			}

			[$methodName, $implementationName] = $typedMethod;

			if (self::acceptsStringParam(new \ReflectionMethod($interface, $methodName)) === true) {
				continue;
			}

			if (self::declaresStringParam($implementationDir . '/' . $implementationName, $methodName) === false) {
				continue;
			}

			return self::signatureMessage($interface, $loadedFrom, $methodName);
		}

		return null;
	}

	/**
	 * Whether the interface was loaded from a copy other than the bundled one.
	 *
	 * @param string|false $loadedFrom value returned by ReflectionClass::getFileName()
	 */
	private static function isForeignCopy(string $interface, string|false $loadedFrom, string $interfaceDir): bool {
		$expected = realpath($interfaceDir . '/' . self::shortName($interface) . '.php');

		if ($expected === false) {
			return false;
		}

		return realpath($loadedFrom === false ? '' : $loadedFrom) !== $expected;
	}

	/**
	 * @param string|false $loadedFrom value returned by ReflectionClass::getFileName()
	 */
	private static function foreignCopyMessage(string $interface, string|false $loadedFrom, string $interfaceDir): string {
		return "Incompatible " . $interface . " loaded from " . self::describePath($loadedFrom) .
			" instead of the bundled " . $interfaceDir . '/' . self::shortName($interface) . '.php' .
			": another copy of psr/http-message is being autoloaded ahead of vendor/. " .
			"Run 'composer install' to rebuild vendor/, then remove or disable the other copy " .
			"(for example the distribution's php-psr-http-message package under include_path, " .
			"such as /usr/share/php).";
	}

	/**
	 * @param string|false $loadedFrom value returned by ReflectionClass::getFileName()
	 */
	private static function signatureMessage(string $interface, string|false $loadedFrom, string $methodName): string {
		return "Incompatible " . $interface . " loaded from " . self::describePath($loadedFrom) .
			": " . $methodName . "() must declare a non-nullable string parameter to be satisfied by the bundled " .
			"guzzlehttp/psr7, which requires psr/http-message >= 2.0. " .
			"Run 'composer install' to rebuild vendor/, and make sure no other copy of psr/http-message " .
			"is autoloaded before vendor/ (for example a distribution package installed under " .
			"include_path, such as /usr/share/php).";
	}

	/** @return string short interface name, e.g. `RequestInterface` */
	private static function shortName(string $interface): string {
		return basename(str_replace('\\', '/', $interface));
	}

	/** @return string|null directory of an installed package, with an optional suffix */
	private static function packageDir(string $package, string $suffix = ''): ?string {
		if (class_exists('Composer\\InstalledVersions') === true &&
				Composer\InstalledVersions::isInstalled($package) === true) {
			$dir = Composer\InstalledVersions::getInstallPath($package);

			if ($dir !== null && is_dir($dir . $suffix) === true) {
				return $dir . $suffix;
			}
		}

		// Fall back to the bundled path when composer's install metadata is
		// stale or missing (a copied vendor tree is itself a common cause of a
		// psr/http-message mismatch).
		$fallback = __DIR__ . '/../vendor/' . $package . $suffix;

		return is_dir($fallback) === true ? $fallback : null;
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

	/**
	 * Whether the psr7 implementation types the given method's parameter as string.
	 *
	 * The file is read rather than loaded, because loading it is what raises the
	 * fatal. An unreadable file reports no problem, so a failed check cannot block
	 * an install that would otherwise work.
	 */
	private static function declaresStringParam(string $implementationFile, string $methodName = 'withScheme'): bool {
		if (is_readable($implementationFile) === false) {
			return false;
		}

		$source = file_get_contents($implementationFile);

		if ($source === false) {
			return false;
		}

		$method = preg_quote($methodName, '/');

		return preg_match('/function\s+' . $method . '\s*\(\s*\\\\?string\s+\$/i', $source) === 1;
	}
}
