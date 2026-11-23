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

	function getscheduledtasks(): void {
		?>
		<table width='100%' class='event-log'>
		<tr>
			<th><?= __("Task name") ?></th>
			<th><?= __("Schedule") ?></th>
			<th><?= __("Last executed") ?></th>
			<th><?= __("Duration (seconds)") ?></th>
			<th><?= __("Return code") ?></th>
		</tr>
		<?php

		$task_records = ORM::for_table('ttrss_scheduled_tasks')
			->order_by_asc(['last_cron_expression', 'task_name'])
			->find_many();

		foreach ($task_records as $task) {
			$row_style = $task->last_rc === 0 ? 'text-success' : 'text-error';

			?>
			<tr>
				<td class="<?= $row_style ?>"><?= $task->task_name ?></td>
				<td><?= $task->last_cron_expression ?></td>
				<td><?= TimeHelper::make_local_datetime($task->last_run) ?></td>
				<td><?= $task->last_duration ?></td>
				<td><?= $task->last_rc ?></td>
			</tr>
			<?php
		}

		?>
		</table>
		<?php
	}

	/**
	 * JSON event log for the Vue system screen.
	 */
	function getLog(): void {
		$severity = (int) ($_REQUEST['severity'] ?? E_USER_WARNING);
		$page = max(0, (int) ($_REQUEST['page'] ?? 0));

		if (Config::get(Config::LOG_DESTINATION) != Logger::LOG_DEST_SQL) {
			print json_encode([
				'entries' => [],
				'page' => 0,
				'pages' => 1,
				'total' => 0,
				'severity' => $severity,
				'enabled' => false,
			]);
			return;
		}

		$errno_values = match ($severity) {
			E_USER_ERROR => [E_ERROR, E_USER_ERROR, E_PARSE, E_COMPILE_ERROR],
			E_USER_WARNING => [E_ERROR, E_USER_ERROR, E_PARSE, E_COMPILE_ERROR, E_WARNING, E_USER_WARNING, E_DEPRECATED, E_USER_DEPRECATED],
			default => [],
		};

		if (count($errno_values) > 0) {
			$errno_qmarks = arr_qmarks($errno_values);
			$errno_filter_qpart = "errno IN ($errno_qmarks)";
		} else {
			$errno_filter_qpart = "true";
		}

		$sth = $this->pdo->prepare("SELECT COUNT(id) AS total FROM ttrss_error_log WHERE $errno_filter_qpart");
		$sth->execute($errno_values);
		$row = $sth->fetch();
		$total = $row ? (int) $row['total'] : 0;

		$pages = max(1, (int) ceil($total / self::LOG_PAGE_LIMIT));
		$page = min($page, $pages - 1);
		$offset = self::LOG_PAGE_LIMIT * $page;

		$sth = $this->pdo->prepare("SELECT errno, errstr, filename, lineno, created_at, login, context
			FROM ttrss_error_log LEFT JOIN ttrss_users ON (owner_uid = ttrss_users.id)
			WHERE $errno_filter_qpart
			ORDER BY ttrss_error_log.id DESC
			LIMIT " . self::LOG_PAGE_LIMIT . " OFFSET $offset");
		$sth->execute($errno_values);

		$entries = [];

		while ($line = $sth->fetch()) {
			$errno = (int) $line['errno'];

			$entries[] = [
				'errno' => $errno,
				'errno_name' => Logger::ERROR_NAMES[$errno] ?? '',
				'filename' => $line['filename'] . ':' . $line['lineno'],
				'message' => $line['errstr'],
				'context' => $line['context'],
				'login' => $line['login'] ?? '',
				'date' => TimeHelper::make_local_datetime($line['created_at']),
			];
		}

		print json_encode([
			'entries' => $entries,
			'page' => $page,
			'pages' => $pages,
			'total' => $total,
			'severity' => $severity,
			'enabled' => true,
		]);
	}

	/**
	 * JSON scheduled-task table for the Vue system screen.
	 */
	function getScheduledTasksList(): void {
		$task_records = ORM::for_table('ttrss_scheduled_tasks')
			->order_by_asc(['last_cron_expression', 'task_name'])
			->find_many();

		$rv = [];

		foreach ($task_records as $task) {
			$rv[] = [
				'task_name' => $task->task_name,
				'schedule' => $task->last_cron_expression,
				'last_run' => TimeHelper::make_local_datetime($task->last_run),
				'duration' => $task->last_duration,
				'rc' => (int) $task->last_rc,
			];
		}

		print json_encode(['tasks' => $rv]);
	}

	function getphpinfo(): void {
		ob_start();
		phpinfo();
		$info = ob_get_contents();
		ob_end_clean();

		print preg_replace( '%^.*<body>(.*)</body>.*$%ms','$1', (string)$info);
	}

}
