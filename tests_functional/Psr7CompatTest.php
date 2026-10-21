<?php
use PHPUnit\Framework\TestCase;

/** Probe interface whose withScheme() leaves its parameter untyped. */
interface Psr7CompatProbeUntyped {
	public function withScheme($scheme);
}

/** Probe interface whose withScheme() types its parameter as `string`. */
interface Psr7CompatProbeString {
	public function withScheme(string $scheme);
}

/** Probe interface whose withScheme() types its parameter as `?string`. */
interface Psr7CompatProbeNullableString {
	public function withScheme(?string $scheme);
}

/** Probe interface whose withScheme() types its parameter as `mixed`. */
interface Psr7CompatProbeMixed {
	public function withScheme(mixed $scheme);
}

/** Probe interface whose withScheme() types its parameter as a union. */
interface Psr7CompatProbeUnion {
	public function withScheme(string|int $scheme);
}

/**
 * Tests for the PSR-7 compatibility guard used at bootstrap.
 *
 * The guard has to accept a psr/http-message whose withScheme() is satisfied by
 * the bundled guzzlehttp/psr7 3.x `string $scheme` implementation, and reject
 * the older untyped 1.0.x interface that makes PHP abort while loading
 * GuzzleHttp\Psr7\Uri.
 *
 * PHPUnit is installed as a CI tool rather than a Composer dependency, so the
 * analyzer cannot resolve the base class or the inherited assertions; the
 * suppressions below cover only that resolution gap.
 */
final class Psr7CompatTest extends TestCase { // skipcq: PHP-W1010

	/** The bundled vendor tree must be accepted: psr7 3.x with psr/http-message 2.0. */
	public function testBundledVendorIsCompatible(): void {
		self::assertNull(Psr7Compat::check()); // skipcq: PHP-E1002
	}

	/** The bundled psr7 declares `string $scheme`, which the guard must detect. */
	public function testBundledPsr7DeclaresStringParam(): void {
		self::assertTrue( // skipcq: PHP-E1002
			self::declaresStringParam(__DIR__ . '/../vendor/guzzlehttp/psr7/src/Uri.php'));
	}

	/** A psr7 2.x-style untyped implementation must not be treated as a conflict. */
	public function testUntypedPsr7IsNotAConflict(): void {
		$file = self::temporaryFile("<?php\nclass Psr7CompatProbePsr7 { public function withScheme(\$scheme) {} }\n");

		try {
			self::assertFalse(self::declaresStringParam($file)); // skipcq: PHP-E1002
		} finally {
			unlink($file);
		}
	}

	/** An unreadable file reports no problem, so the check can never block a valid install. */
	public function testMissingFileReportsNoProblem(): void {
		self::assertFalse( // skipcq: PHP-E1002
			self::declaresStringParam(sys_get_temp_dir() . '/psr7compat-does-not-exist'));
	}

	/** A non-nullable `string` parameter is exactly what psr7 3.x satisfies. */
	public function testNonNullableStringIsAccepted(): void {
		self::assertTrue(self::acceptsStringParam(Psr7CompatProbeString::class)); // skipcq: PHP-E1002
	}

	/** psr/http-message 1.0.x leaves the parameter untyped: the case that breaks psr7 3.x. */
	public function testUntypedIsRejected(): void {
		self::assertFalse(self::acceptsStringParam(Psr7CompatProbeUntyped::class)); // skipcq: PHP-E1002
	}

	/** `?string` is not satisfied by an implementation that rejects null. */
	public function testNullableStringIsRejected(): void {
		self::assertFalse(self::acceptsStringParam(Psr7CompatProbeNullableString::class)); // skipcq: PHP-E1002
	}

	/** `mixed` is wider than the implementation accepts. */
	public function testMixedIsRejected(): void {
		self::assertFalse(self::acceptsStringParam(Psr7CompatProbeMixed::class)); // skipcq: PHP-E1002
	}

	/** A union admits values the implementation rejects. */
	public function testUnionIsRejected(): void {
		self::assertFalse(self::acceptsStringParam(Psr7CompatProbeUnion::class)); // skipcq: PHP-E1002
	}

	/** @param class-string $interface probe interface to inspect */
	private static function acceptsStringParam(string $interface): bool {
		return (bool)(new ReflectionMethod('Psr7Compat', 'acceptsStringParam'))
			->invoke(null, new ReflectionMethod($interface, 'withScheme'));
	}

	/** @param string $file path to a PHP source file to inspect */
	private static function declaresStringParam(string $file): bool {
		return (bool)(new ReflectionMethod('Psr7Compat', 'declaresStringParam'))->invoke(null, $file);
	}

	/** @param string $contents PHP source to write to a throwaway file */
	private static function temporaryFile(string $contents): string {
		$file = tempnam(sys_get_temp_dir(), 'psr7compat');
		file_put_contents($file, $contents);

		return $file;
	}
}
