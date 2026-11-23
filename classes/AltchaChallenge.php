<?php
/**
 * Altcha proof-of-work challenge support.
 *
 * The browser renders the official Altcha widget, which fetches a challenge
 * from `public.php?op=loginchallenge` and posts a signed solution. The server
 * verifies the HMAC signature, the hash, expiry and replay state.
 */
class AltchaChallenge {
        private const MAX_NUMBER = 100000;
        private const TTL = 300;
        private const SESSION_KEY = 'altcha_used';

        private static function hmac_key(): string {
                $env = getenv('TTRSS_ALTCHA_HMAC_KEY');
                if ($env) {
                        return $env;
                }

                $dir = rtrim((string) Config::get(Config::CACHE_DIR), '/') . '/altcha';
                if (!is_dir($dir)) {
                        @mkdir($dir, 0777, true);
                }
                $file = $dir . '/hmac.key';
                if (is_file($file)) {
                        $key = trim((string) file_get_contents($file));
                        if ($key !== '') {
                                return $key;
                        }
                }

                $key = bin2hex(random_bytes(32));
                @file_put_contents($file, $key, LOCK_EX);
                @chmod($file, 0600);
                return $key;
        }

        static function create(): array {
                $salt = bin2hex(random_bytes(16));
                $number = random_int(1000, self::MAX_NUMBER);
                $challenge = hash('sha256', $salt . $number);

                return [
                        'algorithm' => 'SHA-256',
                        'challenge' => $challenge,
                        'salt' => $salt,
                        'signature' => hash_hmac('sha256', $challenge, self::hmac_key()),
                        'maxnumber' => self::MAX_NUMBER,
                        'expires' => time() + self::TTL,
                ];
        }

        static function verify(string $payload): bool {
                if (session_status() !== PHP_SESSION_ACTIVE) {
                        session_start();
                }

                $decoded = base64_decode(strtr($payload, '-_', '+/'), true);
                if ($decoded === false) {
                        return false;
                }

                $data = json_decode($decoded, true);
                if (!is_array($data)) {
                        return false;
                }

                $challenge = (string) ($data['challenge'] ?? '');
                $salt = (string) ($data['salt'] ?? '');
                $signature = (string) ($data['signature'] ?? '');
                $number = $data['number'] ?? null;

                if ($challenge === '' || $salt === '' || $signature === '' || !is_numeric($number)) {
                        return false;
                }

                $expected = hash_hmac('sha256', $challenge, self::hmac_key());
                if (!hash_equals($expected, $signature)) {
                        return false;
                }

                if (isset($data['expires']) && is_numeric($data['expires']) && (int) $data['expires'] < time()) {
                        return false;
                }

                if (!hash_equals($challenge, hash('sha256', $salt . (int) $number))) {
                        return false;
                }

                $now = time();
                $used = $_SESSION[self::SESSION_KEY] ?? [];
                $used = array_filter($used, static fn($ts) => is_int($ts) && $ts >= $now - self::TTL);

                if (isset($used[$challenge])) {
                        return false;
                }

                $used[$challenge] = $now;
                $_SESSION[self::SESSION_KEY] = $used;

                return true;
        }
}
