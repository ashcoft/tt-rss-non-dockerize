<?php

class Pref_System extends Handler_Administrative {

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

	function getphpinfo(): void {
		ob_start();
		phpinfo();
		$info = ob_get_contents();
		ob_end_clean();

		print preg_replace( '%^.*<body>(.*)</body>.*$%ms','$1', (string)$info);
	}

}
