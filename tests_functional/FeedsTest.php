<?php
use PHPUnit\Framework\TestCase;

final class FeedsTest extends TestCase {

    protected function setUp(): void {
        $_SESSION['uid'] = 1;
    }

    protected function tearDown(): void {
        unset($_SESSION['uid']);
    }

    /**
     * Test _get_title for all special feed IDs that return hardcoded strings.
     * These do not require a database connection.
     */
    public function test_get_title_special_feeds(): void {
        $this->assertEquals(
            __("Starred articles"),
            Feeds::_get_title(Feeds::FEED_STARRED, $_SESSION['uid'])
        );
        $this->assertEquals(
            __("Published articles"),
            Feeds::_get_title(Feeds::FEED_PUBLISHED, $_SESSION['uid'])
        );
        $this->assertEquals(
            __("Fresh articles"),
            Feeds::_get_title(Feeds::FEED_FRESH, $_SESSION['uid'])
        );
        $this->assertEquals(
            __("All articles"),
            Feeds::_get_title(Feeds::FEED_ALL, $_SESSION['uid'])
        );
        $this->assertEquals(
            __("Archived articles"),
            Feeds::_get_title(Feeds::FEED_ARCHIVED, $_SESSION['uid'])
        );
        $this->assertEquals(
            __("Recently read"),
            Feeds::_get_title(Feeds::FEED_RECENTLY_READ, $_SESSION['uid'])
        );
    }

    /**
     * Test _get_title for the error feed ID.
     * FEED_ERROR (-7) is < 0 and >= LABEL_BASE_INDEX, so it falls through
     * to the final else branch which returns the id as a string.
     */
    public function test_get_title_error_feed(): void {
        $this->assertEquals(
            "-7",
            Feeds::_get_title(Feeds::FEED_ERROR, $_SESSION['uid'])
        );
    }

    /**
     * Test _get_title with a non-numeric string id falls through to the
     * final else branch.
     */
    public function test_get_title_non_numeric_id(): void {
        $this->assertEquals(
            "some-string-id",
            Feeds::_get_title("some-string-id", $_SESSION['uid'])
        );
    }

    /**
     * A malformed interval must be rejected, not silently read as the
     * default interval (key 0). filter_var() returns false for these, which a
     * loose in_array() would match against 0.
     */
    public function test_validate_update_interval_rejects_malformed(): void {
        foreach (['abc', '60.5', '', '0x1E', '60abc', []] as $malformed) {
            $this->assertFalse(
                Feeds::validateUpdateInterval($malformed),
                "malformed interval " . var_export($malformed, true) . " must be rejected"
            );
        }
    }

    /** Surrounding whitespace is tolerated, as filter_var() strips it. */
    public function test_validate_update_interval_tolerates_whitespace(): void {
        $this->assertSame(60, Feeds::validateUpdateInterval(' 60 '));
    }

    /** A well-formed but disallowed interval is rejected too. */
    public function test_validate_update_interval_rejects_unknown(): void {
        $this->assertFalse(Feeds::validateUpdateInterval(9000));
        $this->assertFalse(Feeds::validateUpdateInterval('9000'));
    }

    /** The allowed intervals (including the 0 default) are accepted. */
    public function test_validate_update_interval_accepts_allowed(): void {
        foreach (array_keys(Feeds::_get_update_intervals()) as $allowed) {
            $this->assertSame(
                $allowed,
                Feeds::validateUpdateInterval($allowed),
                "allowed interval $allowed must be accepted"
            );
            $this->assertSame($allowed, Feeds::validateUpdateInterval((string)$allowed));
        }
    }

    /** Interval keys are shared by both helpers, so the default is key 0. */
    public function test_update_intervals_include_default_only_when_requested(): void {
        $this->assertArrayHasKey(0, Feeds::_get_update_intervals());
        $this->assertArrayNotHasKey(0, Feeds::_get_update_intervals(with_default: false));
    }
}
