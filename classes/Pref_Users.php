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

	/**
 * JSON user list for the Vue administration tab.
 *
 * Mirrors the table built by index(): same search and sort parameters, same
 * columns. The access-level names are included so the client can render them
 * without duplicating UserHelper constants.
 */
function getusersjson(): void {
	global $access_level_names;

	$user_search = clean($_REQUEST["search"] ?? "");

	if (array_key_exists("search", $_REQUEST)) {
		$_SESSION["prefs_user_search"] = $user_search;
	} else {
		$user_search = ($_SESSION["prefs_user_search"] ?? "");
	}

	$sort = clean($_REQUEST["sort"] ?? "");

	if (!$sort || $sort == "undefined") {
		$sort = "login";
	}

	if (!in_array($sort, ["login", "access_level", "created", "num_feeds", "last_login"])) {
		$sort = "login";
	}

	if ($sort != "login") {
		$sort = "$sort DESC";
	}

	$users = ORM::for_table('ttrss_users')
		->table_alias('u')
		->left_outer_join("ttrss_feeds", ["owner_uid", "=", "u.id"], 'f')
		->select_expr('u.*,COUNT(f.id) AS num_feeds')
		->where_like("login", $user_search ? "%$user_search%" : "%")
		->order_by_expr($sort)
		->group_by_expr('u.id')
		->find_many();

	$rv = [];

	foreach ($users as $user) {
		$rv[] = [
			"id" => (int)$user["id"],
			"login" => $user["login"],
			"access_level" => (int)$user["access_level"],
			"access_level_name" => $access_level_names[$user["access_level"]] ?? "",
			"num_feeds" => (int)$user["num_feeds"],
			"created" => TimeHelper::make_local_datetime($user["created"]),
			"last_login" => TimeHelper::make_local_datetime($user["last_login"]),
		];
	}

	print json_encode([
		"users" => $rv,
		"access_level_names" => $access_level_names,
	]);
}

}
