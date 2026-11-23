<?php
class Pref_Users extends Handler_Administrative {
		function csrf_ignore(string $method): bool {
			return $method == "index";
		}

		function edit(): void {
			$user = ORM::for_table('ttrss_users')
				->select_many('id', 'login', 'access_level', 'email', 'full_name', 'otp_enabled')
				->find_one((int)$_REQUEST["id"])
				->as_array();

			global $access_level_names;

			if ($user) {
				print json_encode([
					"user" => $user,
					"access_level_names" => $access_level_names
				]);
			}
		}

		/**
	 * JSON list for the Vue users screen.
	 */
	function getUsers(): void {
		global $access_level_names;

		$search = clean((string) ($_REQUEST['search'] ?? ''));
		$sort = clean((string) ($_REQUEST['sort'] ?? ''));

		$allowed = ['login', 'access_level', 'created', 'num_feeds', 'last_login'];

		if (!in_array($sort, $allowed)) {
			$sort = 'login';
		}

		$order = $sort === 'login' ? 'login' : "$sort DESC";

		$users = ORM::for_table('ttrss_users')
			->table_alias('u')
			->left_outer_join('ttrss_feeds', ['owner_uid', '=', 'u.id'], 'f')
			->select_expr('u.id, u.login, u.access_level, u.email, u.full_name, u.otp_enabled, u.created, u.last_login, COUNT(f.id) AS num_feeds')
			->where_like('login', $search ? "%$search%" : "%")
			->order_by_expr($order)
			->group_by_expr('u.id')
			->find_many();

		$rv = [];

		foreach ($users as $user) {
			$level = (int) $user['access_level'];

			$rv[] = [
				'id' => (int) $user['id'],
				'login' => $user['login'],
				'access_level' => $level,
				'access_level_name' => $access_level_names[$level] ?? '',
				'email' => $user['email'],
				'full_name' => $user['full_name'],
				'otp_enabled' => (bool) $user['otp_enabled'],
				'num_feeds' => (int) $user['num_feeds'],
				'created' => TimeHelper::make_local_datetime($user['created']),
				'last_login' => TimeHelper::make_local_datetime($user['last_login']),
			];
		}

		print json_encode([
			'users' => $rv,
			'access_level_names' => $access_level_names,
		]);
	}

	/**
	 * JSON details for one user, including their subscribed feeds.
	 */
	function getUserDetails(): void {
		$id = (int) clean($_REQUEST['id'] ?? 0);

		$user = ORM::for_table('ttrss_users')
			->table_alias('u')
			->select_many('u.login', 'u.access_level')
			->select_many_expr([
				'created' => 'SUBSTRING_FOR_DATE(u.created,1,16)',
				'last_login' => 'SUBSTRING_FOR_DATE(u.last_login,1,16)',
				'stored_articles' => '(SELECT COUNT(ue.int_id) FROM ttrss_user_entries ue WHERE ue.owner_uid = u.id)',
			])
			->find_one($id);

		if (!$user) {
			print json_encode(['error' => __('User not found')]);
			return;
		}

		$feeds = ORM::for_table('ttrss_feeds')
			->select_many('id', 'title', 'site_url')
			->where('owner_uid', $id)
			->order_by_expr('LOWER(title)')
			->find_many();

		$feed_rows = [];

		foreach ($feeds as $feed) {
			$feed_rows[] = [
				'id' => (int) $feed->id,
				'title' => $feed->title,
				'site_url' => $feed->site_url,
				'icon_url' => Feeds::_get_icon_url($feed->id, 'images/blank_icon.gif'),
			];
		}

		print json_encode([
			'login' => $user->login,
			'access_level' => (int) $user->access_level,
			'created' => TimeHelper::make_local_datetime($user->created),
			'last_login' => TimeHelper::make_local_datetime($user->last_login),
			'stored_articles' => (int) $user->stored_articles,
			'feeds' => $feed_rows,
		]);
	}

	function userdetails(): void {
			$id = (int) clean($_REQUEST["id"]);

			$user = ORM::for_table('ttrss_users')
				->table_alias('u')
				->select_many('u.login', 'u.access_level')
				->select_many_expr([
					'created' => 'SUBSTRING_FOR_DATE(u.created,1,16)',
					'last_login' => 'SUBSTRING_FOR_DATE(u.last_login,1,16)',
					'stored_articles' => '(SELECT COUNT(ue.int_id) FROM ttrss_user_entries ue WHERE ue.owner_uid = u.id)',
				])
				->find_one($id);

			if ($user) {
				$created = TimeHelper::make_local_datetime($user->created);
				$last_login = TimeHelper::make_local_datetime($user->last_login);

				$user_owned_feeds = ORM::for_table('ttrss_feeds')
					->select_many('id', 'title', 'site_url')
					->where('owner_uid', $id)
					->order_by_expr('LOWER(title)')
					->find_many();

				?>

				<fieldset>
					<label><?= __('Registered') ?>:</label>
					<?= $created ?>
				</fieldset>

				<fieldset>
					<label><?= __('Last logged in') ?>:</label>
					<?= $last_login ?>
				</fieldset>

				<fieldset>
					<label><?= __('Subscribed feeds') ?>:</label>
					<?= count($user_owned_feeds) ?>
				</fieldset>

				<fieldset>
					<label><?= __('Stored articles') ?>:</label>
					<?= $user->stored_articles ?>
				</fieldset>

				<ul class="panel panel-scrollable list list-unstyled">
					<?php foreach ($user_owned_feeds as $feed) { ?>
						<li>
							<?php
								$icon_url = Feeds::_get_icon_url($feed->id, 'images/blank_icon.gif');
							?>

							<img class="icon" src="<?= htmlspecialchars($icon_url) ?>">

							<a target="_blank" href="<?= htmlspecialchars($feed->site_url) ?>">
								<?= htmlspecialchars($feed->title) ?>
							</a>
						</li>
					<?php } ?>
				</ul>

				<?php

			} else {
				print_error(__('User not found'));
			}

		}

		function editSave(): void {
			$id = (int)$_REQUEST['id'];
			$password = clean($_REQUEST["password"]);
			$user = ORM::for_table('ttrss_users')->find_one($id);

			if ($user) {
				$login = clean($_REQUEST["login"]);

				if ($id == 1) $login = "admin";
				if (!$login) return;

				$user->login = mb_strtolower($login);
				$user->access_level = (int) clean($_REQUEST["access_level"]);
				$user->email = clean($_REQUEST["email"]);
				$user->otp_enabled = checkbox_to_sql_bool($_REQUEST["otp_enabled"] ?? "");

				// force new OTP secret when next enabled
				if (Config::get_schema_version() >= 143 && !$user->otp_enabled) {
					$user->otp_secret = null;
				}

				$user->save();
			}

			if ($password) {
				UserHelper::reset_password($id, false, $password);
			}
		}

		function remove(): void {
			$ids = self::_param_to_int_array($_REQUEST['ids']);

			foreach ($ids as $id) {
				if ($id != $_SESSION['uid'] && $id != 1) {
					ORM::for_table('ttrss_tags')->where('owner_uid', $id)->delete_many();
					ORM::for_table('ttrss_feeds')->where('owner_uid', $id)->delete_many();
					ORM::for_table('ttrss_users')->where('id', $id)->delete_many();
				}
			}
		}

		function add(): void {
			$login = clean($_REQUEST["login"]);

			if (!$login) return; // no blank usernames

			if (!UserHelper::find_user_by_login($login)) {

				$new_password = make_password();

				$user = ORM::for_table('ttrss_users')->create();

				$user->salt = UserHelper::get_salt();
				$user->login = mb_strtolower($login);
				$user->pwd_hash = UserHelper::hash_password($new_password, $user->salt);
				$user->access_level = 0;
				$user->created = Db::NOW();
				$user->save();

				if (!is_null(UserHelper::find_user_by_login($login))) {
					print T_sprintf("Added user %s with password %s",
						$login, $new_password);
				} else {
					print T_sprintf("Could not create user %s", $login);
				}
			} else {
				print T_sprintf("User %s already exists.", $login);
			}
		}

		function resetPass(): void {
			UserHelper::reset_password(clean($_REQUEST["id"]));
		}


}
