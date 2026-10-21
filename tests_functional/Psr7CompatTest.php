<?php
use PHPUnit\Framework\TestCase;

final class Psr7CompatTest extends TestCase {

    /** The bundled vendor tree must be accepted: psr7 3.x with psr/http-message 2.0. */
    public function test_bundled_vendor_is_compatible(): void {
        $this->assertNull(Psr7Compat::check());
    }

    /** psr/http-message >= 1.1 types the parameter, so no conflict is reported. */
    public function test_typed_param_is_accepted(): void {
        $this->assertTrue($this->detects_typed_param('function withScheme(string $scheme): UriInterface'));
    }

    /** psr/http-message 1.0.x leaves it untyped: the case that breaks psr7 3.x. */
    public function test_untyped_param_is_detected(): void {
        $this->assertFalse($this->detects_typed_param('function withScheme($scheme): UriInterface'));
    }

    /** A nullable type is still a type. */
    public function test_nullable_typed_param_is_accepted(): void {
        $this->assertTrue($this->detects_typed_param('function withScheme(?string $scheme)'));
    }

    public function test_whitespace_and_visibility_variants(): void {
        $this->assertTrue($this->detects_typed_param('public function  withScheme (  string   $scheme ) : UriInterface'));
        $this->assertFalse($this->detects_typed_param('public function withScheme($scheme)'));
    }

    /** @param string $declaration a withScheme() declaration to inspect */
    private function detects_typed_param(string $declaration): bool {
        $file = tempnam(sys_get_temp_dir(), 'psr7compat');
        file_put_contents($file, "<?php\nclass Probe {\n    $declaration {}\n}\n");

        try {
            $method = new ReflectionMethod('Psr7Compat', 'requires_typed_param');
            return (bool)$method->invoke(null, $file);
        } finally {
            unlink($file);
        }
    }
}
