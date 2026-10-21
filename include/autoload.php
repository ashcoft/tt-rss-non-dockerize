<?php
	require_once __DIR__ . '/../vendor/autoload.php';

	/* Fail with an actionable message when an incompatible psr/http-message is
		loaded, instead of the cryptic compile-time fatal raised while loading
		GuzzleHttp\Psr7\Uri. See classes/Psr7Compat.php. */
	require_once __DIR__ . '/../classes/Psr7Compat.php';

	$psr7_problem = Psr7Compat::check();

	if ($psr7_problem !== null) {
		if (php_sapi_name() !== 'cli') {
			// The check runs before authentication, so log the detail and show
			// anonymous visitors a generic message instead of server paths.
			error_log($psr7_problem);

			http_response_code(503);
			echo "<h1>Startup failed</h1><p>Incompatible PSR-7 interfaces in vendor/. " .
				"Check the PHP error log for details.</p>";
		} else {
			fwrite(STDERR, "error: $psr7_problem\n");
		}

		exit(1);
	}

	unset($psr7_problem);
