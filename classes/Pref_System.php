<?php

class Pref_System extends Handler_Administrative {

	private const LOG_PAGE_LIMIT = 15;

	function csrf_ignore(string $method): bool {
		return $method === 'index';
	}

	function clearLog(): void {
		$this->pdo->query("DELETE FROM ttrss_error_log");
	}

	function sendTestEmail(): void {
		$mail_address = clean($_REQUEST["mail_address"]);

		$mailer = new Mailer();

		$rc = $mailer->mail([
			'to_name' => '',
			'to_address' => $mail_address,
			'subject' => __('Test message from tt-rss'),
			'message' => __('This message confirms that tt-rss can send outgoing email.'),
		]);

		print json_encode(['rc' => $rc, 'error' => $mailer->error()]);
	}

	function getphpinfo(): void {
		ob_start();
		phpinfo();
		$info = ob_get_contents();
		ob_end_clean();

		print preg_replace( '%^.*<body>(.*)</body>.*$%ms','$1', (string)$info);
	}

/**
 * JSON event log for the Vue system tab.
 *
 * Mirrors _log_viewer(): the same severity filter, paging and columns, but
 * emitted as data. `total_pages` counts full pages, matching the Dojo pager.
 */
function getlogjson(): void {
	$severity = (int) ($_REQUEST["severity"] ?? E_USER_WARNING);
	$page = (int) ($_REQUEST["page"] ?? 0);

	$errno_values = match ($severity) {
		E_USER_ERROR => [E_ERROR, E_USER_ERROR, E_PARSE, E_COMPILE_ERROR],
		E_USER_WARNING => [E_ERROR, E_USER_ERROR, E_PARSE, E_COMPILE_ERROR, E_WARNING, E_USER_WARNING, E_DEPRECATED, E_USER_DEPRECATED],
		default => [],
	};

	if (count($errno_values) > 0) {
		$errno_filter_qpart = "errno IN (".arr_qmarks($errno_values).")";
	} else {
		$errno_filter_qpart = "true";
	}

	$sth = $this->pdo->prepare("SELECT COUNT(id) AS total_pages FROM ttrss_error_log WHERE $errno_filter_qpart");
	$sth->execute($errno_values);
	$total = (int)($sth->fetch()["total_pages"] ?? 0);
	$total_pages = (int)($total / self::LOG_PAGE_LIMIT);

	$offset = self::LOG_PAGE_LIMIT * $page;

	$sth = $this->pdo->prepare("SELECT errno, errstr, filename, lineno, created_at, login, context
		FROM ttrss_error_log LEFT JOIN ttrss_users ON (owner_uid = ttrss_users.id)
		WHERE $errno_filter_qpart
		ORDER BY ttrss_error_log.id DESC
		LIMIT ". self::LOG_PAGE_LIMIT ." OFFSET $offset");
	$sth->execute($errno_values);

	$rv = [];

	while ($line = $sth->fetch()) {
		$rv[] = [
			"errno" => (int)$line["errno"],
			"errno_name" => Logger::ERROR_NAMES[$line["errno"]] ?? "",
			"filename" => $line["filename"],
			"lineno" => (int)$line["lineno"],
			"errstr" => $line["errstr"],
			"context" => $line["context"],
			"login" => $line["login"],
			"created_at" => TimeHelper::make_local_datetime($line["created_at"]),
		];
	}

	print json_encode([
		"page" => $page,
		"total_pages" => $total_pages,
		"severity" => $severity,
		"entries" => $rv,
	]);
}

}
