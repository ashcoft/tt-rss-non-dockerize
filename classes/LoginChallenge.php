<?php
/**
 * Self-hosted bot protection for the login form.
 *
 * The client solves a short SHA-256 proof-of-work challenge before posting
 * credentials. This is supplemented by a honeypot field and a per-IP failure
 * throttle, so a scripted attacker cannot cheaply spray passwords even without
 * an external CAPTCHA provider.
 */
class LoginChallenge {
        private const SESSION_KEY = 'login_challenges';
        private const CHALLENGE_TTL = 120;
        private const DEFAULT_BITS = 18;
        private const MIN_BITS = 12;
        private const MAX_BITS = 24;
        private const MAX_ACTIVE_CHALLENGES = 4;
        private const MAX_FAILURES = 8;
        private const FAILURE_WINDOW = 600;

        private static function ensure_session(): void {
                if (session_status() !== PHP_SESSION_ACTIVE) {
                        session_start();
                }
        }

        /** Difficulty in leading zero bits. Configurable with TTRSS_LOGIN_POW_BITS. */
        static function difficulty(): int {
                $bits = (int) (getenv('TTRSS_LOGIN_POW_BITS') ?: self::DEFAULT_BITS);
                return max(self::MIN_BITS, min(self::MAX_BITS, $bits));
        }

        /** Issue a new challenge and return it to the browser. */
        static function issue(): array {
                self::ensure_session();
                $now = time();
                $active = $_SESSION[self::SESSION_KEY] ?? [];

                $active = array_filter($active, static fn($item) => is_array($item) && ($item['expires'] ?? 0) >= $now);
                if (count($active) >= self::MAX_ACTIVE_CHALLENGES) {
                        $active = array_slice($active, -(self::MAX_ACTIVE_CHALLENGES - 1), null, true);
                }

                $challenge = bin2hex(random_bytes(24));
                $difficulty = self::difficulty();
                $active[$challenge] = ['expires' => $now + self::CHALLENGE_TTL, 'difficulty' => $difficulty];
                $_SESSION[self::SESSION_KEY] = $active;

                return [
                        'challenge' => $challenge,
                        'difficulty' => $difficulty,
                        'algorithm' => 'sha256',
                        'expires_in' => self::CHALLENGE_TTL,
                ];
        }

        /** Verify a submitted nonce and consume the challenge. */
        static function verify(string $challenge, string $nonce): bool {
                self::ensure_session();
                $active = $_SESSION[self::SESSION_KEY] ?? [];
                $entry = $active[$challenge] ?? null;

                if (!is_array($entry) || ($entry['expires'] ?? 0) < time()) {
                        return false;
                }

                // Consume the challenge whether the nonce is valid or not.
                unset($active[$challenge]);
                $_SESSION[self::SESSION_KEY] = $active;

                if (!preg_match('/^\d{1,12}$/', $nonce)) {
                        return false;
                }

                $hash = hash('sha256', $challenge . ':' . $nonce);
                return self::leading_zero_bits($hash) >= (int) $entry['difficulty'];
        }

        /** Count leading zero bits in a hex digest. */
        static function leading_zero_bits(string $hex): int {
                $bits = 0;

                foreach (str_split($hex) as $char) {
                        $value = hexdec($char);

                        if ($value === 0) {
                                $bits += 4;
                                continue;
                        }

                        if ($value < 2) {
                                $bits += 3;
                        } else if ($value < 4) {
                                $bits += 2;
                        } else if ($value < 8) {
                                $bits += 1;
                        }

                        break;
                }

                return $bits;
        }

        private static function throttle_file(): string {
                $dir = rtrim((string) Config::get(Config::CACHE_DIR), '/') . '/login-throttle';

                if (!is_dir($dir)) {
                        @mkdir($dir, 0777, true);
                }

                $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
                return $dir . '/' . hash('sha256', $ip) . '.json';
        }

        /** @return array<int, int> */
        private static function recent_failures(): array {
                $file = self::throttle_file();
                if (!is_file($file)) {
                        return [];
                }

                $data = json_decode((string) @file_get_contents($file), true);
                if (!is_array($data)) {
                        return [];
                }

                $cutoff = time() - self::FAILURE_WINDOW;
                return array_values(array_filter($data, static fn($ts) => is_int($ts) && $ts >= $cutoff));
        }

        static function is_throttled(): bool {
                return count(self::recent_failures()) >= self::MAX_FAILURES;
        }

        static function record_failure(): void {
                $data = self::recent_failures();
                $data[] = time();
                @file_put_contents(self::throttle_file(), json_encode($data), LOCK_EX);
        }

        static function clear_failures(): void {
                @unlink(self::throttle_file());
        }

        /** @return array{ok: bool, error?: string} */
        static function verify_request(): array {
                self::ensure_session();

                if (Config::get(Config::SINGLE_USER_MODE)) {
                        return ['ok' => true];
                }

                if (self::is_throttled()) {
                        return ['ok' => false, 'error' => 'Too many failed login attempts. Try again later.'];
                }

                // Honeypot: real browsers leave this field empty.
                if (!empty($_POST['website'])) {
                        return ['ok' => false, 'error' => 'Security check failed.'];
                }

                // The OTP step is already gated by the second factor.
                if (!empty($_POST['otp'])) {
                        return ['ok' => true];
                }

                if (!empty($_POST['altcha'])) {
                        if (!AltchaChallenge::verify((string) $_POST['altcha'])) {
                                return ['ok' => false, 'error' => 'Security check failed. Reload and try again.'];
                        }

                        return ['ok' => true];
                }

                $challenge = (string) ($_POST['challenge'] ?? '');
                $nonce = (string) ($_POST['nonce'] ?? '');

                if ($challenge === '' || $nonce === '') {
                        return ['ok' => false, 'error' => 'Security check required. Reload and try again.'];
                }

                if (!self::verify($challenge, $nonce)) {
                        return ['ok' => false, 'error' => 'Security check failed. Reload and try again.'];
                }

                return ['ok' => true];
        }
}
