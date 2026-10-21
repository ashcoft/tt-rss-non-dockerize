<?php
use PHPUnit\Framework\TestCase;

/**
 * Tests for the PSR-7 compatibility guard used by Config::sanity_check().
 *
 * The guard has to accept a psr/http-message whose withScheme() is satisfied by
 * the bundled guzzlehttp/psr7 3.x `string $scheme` implementation, and reject
 * the older untyped 1.0.x interface that makes PHP abort while loading
 * GuzzleHttp\Psr7\Uri.
 *
 * PHPUnit is installed as a CI tool rather than a Composer dependency, so the
 * analyzer cannot resolve the base class or its inherited assertions. The
 * suppressions below cover only that resolution gap; the tests themselves run
 * under phpunit in CI.
 */
final class Psr7CompatTest extends TestCase { // skipcq

	/** The bundled vendor tree must be accepted: psr7 3.x with psr/http-message 2.0. */
	public function testBundledVendorIsCompatible(): void {
		$this->assertNull(Psr7Compat::check()); // skipcq
	}

	/** The bundled psr7 declares `string $scheme`, which the guard must detect. */
	public function testBundledPsr7DeclaresStringParam(): void {
		$this->assertTrue( // skipcq
			self::declaresStringParam(__DIR__ . '/../vendor/guzzlehttp/psr7/src/Uri.php'));
	}

	/** A psr7 2.x-style untyped implementation must not be treated as a conflict. */
	public function testUntypedPsr7IsNotAConflict(): void {
		$file = self::temporaryFile('Psr7CompatProbePsr7', 'withScheme($scheme)');

		try {
			$this->assertFalse(self::declaresStringParam($file)); // skipcq
		} finally {
			unlink($file);
		}
	}

	/** An unreadable file reports no problem, so the check can never block a valid install. */
	public function testMissingFileReportsNoProblem(): void {
		$this->assertFalse( // skipcq
			self::declaresStringParam(sys_get_temp_dir() . '/psr7compat-does-not-exist'));
	}

	/** A non-nullable `string` parameter is exactly what psr7 3.x satisfies. */
	public function testNonNullableStringIsAccepted(): void {
		$this->assertTrue($this->acceptsParam('Psr7CompatProbeString', 'string $scheme')); // skipcq
	}

	/** psr/http-message 1.0.x leaves the parameter untyped: the case that breaks psr7 3.x. */
	public function testUntypedIsRejected(): void {
		$this->assertFalse($this->acceptsParam('Psr7CompatProbeUntyped', '$scheme')); // skipcq
	}

	/** `?string` is not satisfied by an implementation that rejects null. */
	public function testNullableStringIsRejected(): void {
		$this->assertFalse($this->acceptsParam('Psr7CompatProbeNullable', '?string $scheme')); // skipcq
	}

	/** `mixed` is wider than the implementation accepts. */
	public function testMixedIsRejected(): void {
		$this->assertFalse($this->acceptsParam('Psr7CompatProbeMixed', 'mixed $scheme')); // skipcq
	}

	/** A union admits values the implementation rejects. */
	public function testUnionIsRejected(): void {
		$this->assertFalse($this->acceptsParam('Psr7CompatProbeUnion', 'string|int $scheme')); // skipcq
	}

	/** An optional parameter lets callers omit an argument the implementation requires. */
	public function testOptionalParameterIsRejected(): void {
		$this->assertFalse($this->acceptsParam('Psr7CompatProbeOptional', 'string $scheme = ""')); // skipcq
	}

	/** A parameterless declaration cannot be implemented by `withScheme(string $scheme)`. */
	public function testMissingParameterIsRejected(): void {
		$this->assertFalse($this->acceptsParam('Psr7CompatProbeNoParams', '')); // skipcq
	}

	/**
	 * @param string $name unique interface name, so repeated runs cannot clash
	 * @param string $declaration the withScheme() parameter declaration to probe
	 */
	private function acceptsParam(string $name, string $declaration): bool {
		$file = self::temporaryFile($name, "withScheme($declaration)");

		try {
			require_once $file;

			return (bool)(new ReflectionMethod('Psr7Compat', 'acceptsStringParam'))
				->invoke(null, new ReflectionMethod($name, 'withScheme'));
		} finally {
			unlink($file);
		}
	}

	/** @param string $file path to a PHP source file to inspect */
	private static function declaresStringParam(string $file): bool {
		return (bool)(new ReflectionMethod('Psr7Compat', 'declaresStringParam'))->invoke(null, $file);
	}

	/**
	 * @param string $name interface name to declare in the throwaway file
	 * @param string $withScheme complete withScheme() signature to declare
	 */
	private static function temporaryFile(string $name, string $withScheme): string {
		$file = tempnam(sys_get_temp_dir(), 'psr7compat');
		file_put_contents($file, "<?php\ninterface $name { public function $withScheme; }\n");

		return $file;
	}
}
