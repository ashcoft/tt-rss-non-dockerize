<?php
class Pref_Labels extends Handler_Protected {

	function csrf_ignore(string $method): bool {
		return in_array($method, ['index', 'getlabeltree']);
	}

	function edit(): void {
		$label = ORM::for_table('ttrss_labels2')
			->where('owner_uid', $_SESSION['uid'])
			->find_one($_REQUEST['id']);

		if ($label) {
			print json_encode($label->as_array());
		}
	}

	function getlabeltree(): void {
		$root = [];
		$root['id'] = 'root';
		$root['name'] = __('Labels');
		$root['items'] = [];

		$sth = $this->pdo->prepare("SELECT *
			FROM ttrss_labels2
			WHERE owner_uid = ?
			ORDER BY caption");
		$sth->execute([$_SESSION['uid']]);

		while ($line = $sth->fetch()) {
			$root['items'][] = [
				'type' => 'label',
				'id' => 'LABEL:' . $line['id'],
				'bare_id' => $line['id'],
				'name' => $line['caption'],
				'fg_color' => $line['fg_color'],
				'bg_color' => $line['bg_color'],
				'checkbox' => false,
			];
		}

		print json_encode([
			'identifier' => 'id',
			'label' => 'name',
			'items' => [$root],
		]);
	}

	function colorset(): void {
		$kind = clean($_REQUEST["kind"]);
		$ids = self::_param_to_int_array($_REQUEST['ids'] ?? '');
		$color = clean($_REQUEST["color"]);
		$fg = clean($_REQUEST["fg"]);
		$bg = clean($_REQUEST["bg"]);

		foreach ($ids as $id) {

			if ($kind == "fg" || $kind == "bg") {
				$sth = $this->pdo->prepare("UPDATE ttrss_labels2 SET
					{$kind}_color = ? WHERE id = ?
					AND owner_uid = ?");

				$sth->execute([$color, $id, $_SESSION['uid']]);

			} else {

				$sth = $this->pdo->prepare("UPDATE ttrss_labels2 SET
					fg_color = ?, bg_color = ? WHERE id = ?
					AND owner_uid = ?");

				$sth->execute([$fg, $bg, $id, $_SESSION['uid']]);
			}

			/* Remove cached data */

			$sth = $this->pdo->prepare("UPDATE ttrss_user_entries SET label_cache = ''
				WHERE owner_uid = ?");
			$sth->execute([$_SESSION['uid']]);
		}
	}

	function colorreset(): void {
		$ids = self::_param_to_int_array($_REQUEST['ids'] ?? '');

		foreach ($ids as $id) {
			$sth = $this->pdo->prepare("UPDATE ttrss_labels2 SET
				fg_color = '', bg_color = '' WHERE id = ?
				AND owner_uid = ?");
			$sth->execute([$id, $_SESSION['uid']]);

			/* Remove cached data */

			$sth = $this->pdo->prepare("UPDATE ttrss_user_entries SET label_cache = ''
				WHERE owner_uid = ?");
			$sth->execute([$_SESSION['uid']]);
		}
	}

	function save(): void {

		$id = clean($_REQUEST["id"]);
		$caption = clean($_REQUEST["caption"]);

		$this->pdo->beginTransaction();

		$sth = $this->pdo->prepare("SELECT caption FROM ttrss_labels2
			WHERE id = ? AND owner_uid = ?");
		$sth->execute([$id, $_SESSION['uid']]);

		if ($row = $sth->fetch()) {
			$old_caption = $row["caption"];

			$sth = $this->pdo->prepare("SELECT id FROM ttrss_labels2
				WHERE caption = ? AND owner_uid = ?");
			$sth->execute([$caption, $_SESSION['uid']]);

			if (!$sth->fetch()) {
				if ($caption) {
					$sth = $this->pdo->prepare("UPDATE ttrss_labels2 SET
						caption = ? WHERE id = ? AND
						owner_uid = ?");
					$sth->execute([$caption, $id, $_SESSION['uid']]);

					/* Update filters that reference label being renamed */

					$sth = $this->pdo->prepare("UPDATE ttrss_filters2_actions SET
						action_param = ? WHERE action_param = ?
						AND action_id = 7
						AND filter_id IN (SELECT id FROM ttrss_filters2 WHERE owner_uid = ?)");

					$sth->execute([$caption, $old_caption, $_SESSION['uid']]);

					print clean($_REQUEST["caption"]);
				} else {
					print $old_caption;
				}
			} else {
				print $old_caption;
			}
		}

		$this->pdo->commit();

	}

	function remove(): void {
		$ids = self::_param_to_int_array($_REQUEST['ids'] ?? '');

		foreach ($ids as $id) {
			Labels::remove($id, $_SESSION["uid"]);
		}

	}

	function add(): void {
		$caption = clean($_REQUEST["caption"]);
		$output = clean($_REQUEST["output"] ?? false);

		if ($caption) {
			if (Labels::create($caption)) {
				if (!$output) {
					print T_sprintf("Created label <b>%s</b>", htmlspecialchars($caption));
				}
			}
		}
	}

}
