<?php
	require_once __DIR__ . '/../vendor/autoload.php';

	/* Fail with an actionable message when an incompatible psr/http-message is
		loaded, instead of the cryptic compile-time fatal raised while loading
		GuzzleHttp\Psr7\Uri. See classes/Psr7Compat.php. */
	require_once __DIR__ . '/../classes/Psr7Compat.php';

	$psr7_problem = Psr7Compat::check();

	if ($psr7_problem !== null) {
		if (php_sapi_name() != 'cli') {
			http_response_code(503);
			echo "<h1>Startup failed</h1><p>" . htmlspecialchars($psr7_problem, ENT_QUOTES, 'UTF-8') . "</p>";
		} else {
			echo "error: $psr7_problem\n";
		}

		exit(1);
	}

	unset($psr7_problem);
