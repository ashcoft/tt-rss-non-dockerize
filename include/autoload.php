<?php
	/* psr7 3.x requires psr/http-message >= 2.0 and types its method
		signatures. Declare the bundled interfaces before any other autoloader
		can supply an older 1.0.x copy (for example a distribution package
		reachable through include_path, such as /usr/share/php). The guard in
		classes/Psr7Compat.php reports a copy that was already loaded. */
	$psr7_interface_dir = __DIR__ . '/../vendor/psr/http-message/src';

	foreach (['MessageInterface', 'RequestInterface', 'ResponseInterface',
			'ServerRequestInterface', 'StreamInterface', 'UploadedFileInterface',
			'UriInterface'] as $psr7_interface) {
		$psr7_interface_file = $psr7_interface_dir . '/' . $psr7_interface . '.php';

		if (interface_exists('Psr\\Http\\Message\\' . $psr7_interface, false) === false &&
				is_file($psr7_interface_file) === true) {
			require_once $psr7_interface_file;
		}
	}

	unset($psr7_interface_dir, $psr7_interface, $psr7_interface_file);

	require_once __DIR__ . '/../vendor/autoload.php';
