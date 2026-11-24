<?php
class RPC extends Handler_Protected {

	private const RELEASES_LATEST_URL = 'https://api.github.com/repos/ashcoft/tt-rss-non-dockerize/releases/latest';
	private const RELEASE_CHECK_TTL = 3600;

	/*function csrf_ignore(string $method): bool {
		$csrf_ignored = array("completelabels");

		return array_search($method, $csrf_ignored) !== false;
	}*/

	/**
	 * @return array<string, string>
	 */
	private function _translations_as_array(): array {

		global $text_domains;

		$rv = [];

		foreach (array_keys($text_domains) as $domain) {

			/** @var gettext_reader $l10n */
			$l10n = _get_reader($domain);

			for ($i = 0; $i < $l10n->total; $i++) {
				if (isset($l10n->table_originals[$i * 2 + 2]) && $orig = $l10n->get_original_string($i)) {
					if(str_contains($orig, "\000")) { // Plural forms
						$key = explode(chr(0), $orig);

						$rv[$key[0]] = _ngettext($key[0], $key[1], 1); // Singular
						$rv[$key[1]] = _ngettext($key[0], $key[1], 2); // Plural
					} else {
						$translation = _dgettext($domain,$orig);
						$rv[$orig] = $translation;
					}
				}
			}
		}

		return $rv;
	}


	function togglepref(): void {
		$key = clean($_REQUEST["key"]);
		$profile = $_SESSION['profile'] ?? null;
		Prefs::set($key, !Prefs::get($key, $_SESSION['uid'], $profile), $_SESSION['uid'], $profile);
		$value = Prefs::get($key, $_SESSION['uid'], $profile);

		print json_encode(["param" =>$key, "value" => $value]);
	}

	function setpref(): void {
		// set_pref escapes input, so no need to double escape it here
		$key = clean($_REQUEST['key']);
		$value = $_REQUEST['value'];

		Prefs::set($key, $value, $_SESSION['uid'], $_SESSION['profile'] ?? null, $key != 'USER_STYLESHEET');

		print json_encode(["param" =>$key, "value" => $value]);
	}

	function mark(): void {
		$mark = clean($_REQUEST["mark"]);
		$id = clean($_REQUEST["id"]);

		$sth = $this->pdo->prepare("UPDATE ttrss_user_entries SET marked = ?,
					last_marked = NOW()
					WHERE ref_id = ? AND owner_uid = ?");

		$sth->execute([$mark, $id, $_SESSION['uid']]);

		PluginHost::getInstance()->run_hooks(PluginHost::HOOK_ARTICLES_MARK_TOGGLED, [$id]);

		print json_encode(["message" => "UPDATE_COUNTERS"]);
	}

	function delete(): void {
		$ids = self::_param_to_int_array($_REQUEST['ids'] ?? '');

		if (!$ids)
			return;

		ORM::for_table('ttrss_user_entries')
			->where_in('ref_id', $ids)
			->where('owner_uid', $_SESSION['uid'])
			->delete_many();

		print json_encode(["message" => "UPDATE_COUNTERS"]);
	}

	function publ(): void {
		$pub = clean($_REQUEST["pub"]);
		$id = clean($_REQUEST["id"]);

		$sth = $this->pdo->prepare("UPDATE ttrss_user_entries SET
			published = ?, last_published = NOW()
			WHERE ref_id = ? AND owner_uid = ?");

		$sth->execute([$pub, $id, $_SESSION['uid']]);

		PluginHost::getInstance()->run_hooks(PluginHost::HOOK_ARTICLES_PUBLISH_TOGGLED, [$id]);

		print json_encode(["message" => "UPDATE_COUNTERS"]);
	}

	function getRuntimeInfo(): void {
		$reply = [
			'runtime-info' => static::_make_runtime_info()
		];

		print json_encode($reply, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
	}

	function getAllCounters(): void {
		@$seq = (int) $_REQUEST['seq'];

		$feed_id_count = (int) ($_REQUEST["feed_id_count"] ?? -1);
		$label_id_count = (int) ($_REQUEST["label_id_count"] ?? -1);

		// it seems impossible to distinguish empty array [] from a null - both become unset in $_REQUEST
		// so, count is >= 0 means we had an array, -1 means null
		// we need null because it means "return all counters"; [] would return nothing
		$feed_ids = $feed_id_count == -1 ? null : (self::_param_to_int_array($_REQUEST['feed_ids'] ?? '') ?? []);
		$label_ids = $label_id_count == -1 ? null : (self::_param_to_int_array($_REQUEST['label_ids'] ?? '') ?? []);

		$counters = is_array($feed_ids)
			&& !Prefs::get(Prefs::DISABLE_CONDITIONAL_COUNTERS, $_SESSION['uid'], $_SESSION['profile'] ?? null) ?
			Counters::get_conditional($feed_ids, $label_ids) : Counters::get_all();

		$reply = [
			'counters' => $counters,
			'seq' => $seq,
		];

		// the periodic poll asks for all counters; piggyback runtime info on it so the
		// main UI doesn't need a separate request every minute (partial refreshes
		// after marking articles etc. don't need it)
		if ($feed_ids === null)
			$reply['runtime-info'] = static::_make_runtime_info();

		print json_encode($reply, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
	}

	/* GET["cmode"] = 0 - mark as read, 1 - as unread, 2 - toggle */
	function catchupSelected(): void {
		$ids = self::_param_to_int_array($_REQUEST['ids'] ?? '') ?? [];
		$cmode = (int)clean($_REQUEST["cmode"]);

		if (count($ids) > 0)
			Article::_catchup_by_id($ids, $cmode);

		print json_encode(["message" => "UPDATE_COUNTERS",
			"labels" => Article::_labels_of($ids),
			"feeds" => Article::_feeds_of($ids)]);
	}

	function markSelected(): void {
		$ids = self::_param_to_int_array($_REQUEST['ids'] ?? '') ?? [];
		$cmode = (int)clean($_REQUEST["cmode"]);

		if (count($ids) > 0)
			$this->markArticlesById($ids, $cmode);

		print json_encode(["message" => "UPDATE_COUNTERS",
		"labels" => Article::_labels_of($ids),
			"feeds" => Article::_feeds_of($ids)]);
	}

	function publishSelected(): void {
		$ids = self::_param_to_int_array($_REQUEST['ids'] ?? '') ?? [];
		$cmode = (int)clean($_REQUEST["cmode"]);

		if (count($ids) > 0)
			$this->publishArticlesById($ids, $cmode);

		print json_encode(["message" => "UPDATE_COUNTERS",
			"labels" => Article::_labels_of($ids),
			"feeds" => Article::_feeds_of($ids)]);
	}

	function sanityCheck(): void {
		$_SESSION["hasSandbox"] = self::_param_to_bool($_REQUEST["hasSandbox"] ?? false);
		$_SESSION["clientTzOffset"] = clean($_REQUEST["clientTzOffset"]);

		$client_location = $_REQUEST["clientLocation"];

		$error = Errors::E_SUCCESS;
		$error_params = [];

		$client_scheme = parse_url($client_location, PHP_URL_SCHEME);
		$server_scheme = parse_url(Config::get_self_url(), PHP_URL_SCHEME);

		if (Config::is_migration_needed()) {
			$error = Errors::E_SCHEMA_MISMATCH;
		} else if ($client_scheme != $server_scheme) {
			$error = Errors::E_URL_SCHEME_MISMATCH;
			$error_params["client_scheme"] = $client_scheme;
			$error_params["server_scheme"] = $server_scheme;
			$error_params["self_url_path"] = Config::get_self_url();
		}

		if ($error == Errors::E_SUCCESS) {
			print json_encode([
				'init-params' => $this->_make_init_params(),
				'runtime-info' => static::_make_runtime_info(),
				'translations' => $this->_translations_as_array(),
			]);
		} else {
			print Errors::to_json($error, $error_params);
		}
	}

	/*function completeLabels() {
		$search = clean($_REQUEST["search"]);

		$sth = $this->pdo->prepare("SELECT DISTINCT caption FROM
				ttrss_labels2
				WHERE owner_uid = ? AND
				LOWER(caption) LIKE LOWER(?) ORDER BY caption
				LIMIT 5");
		$sth->execute([$_SESSION['uid'], "%$search%"]);

		print "<ul>";
		while ($line = $sth->fetch()) {
			print "<li>" . $line["caption"] . "</li>";
		}
		print "</ul>";
	}*/

	function catchupFeed(): void {
		$feed_id = clean($_REQUEST['feed_id']);
		$is_cat = self::_param_to_bool($_REQUEST['is_cat'] ?? false);
		$mode = clean($_REQUEST['mode'] ?? '');
		$search_query = clean($_REQUEST['search_query']);
		$search_lang = clean($_REQUEST['search_lang']);

		Feeds::_catchup($feed_id, $is_cat, null, $mode, [$search_query, $search_lang]);

		// return counters here synchronously so that frontend can figure out next unread feed properly
		print json_encode(['counters' => Counters::get_all()]);

		//print json_encode(array("message" => "UPDATE_COUNTERS"));
	}

	function setWidescreen(): void {
		$wide = (int) clean($_REQUEST["wide"]);

		Prefs::set(Prefs::WIDESCREEN_MODE, $wide, $_SESSION['uid'], $_SESSION['profile'] ?? null);

		print json_encode(["wide" => $wide]);
	}

	/**
	 * @param array<int, int> $ids
	 */
	private function markArticlesById(array $ids, int $cmode): void {

		$ids_qmarks = arr_qmarks($ids);

		if ($cmode == Article::CATCHUP_MODE_MARK_AS_READ) {
			$sth = $this->pdo->prepare("UPDATE ttrss_user_entries SET
				marked = false, last_marked = NOW()
					WHERE ref_id IN ($ids_qmarks) AND owner_uid = ?");
		} else if ($cmode == Article::CATCHUP_MODE_MARK_AS_UNREAD) {
			$sth = $this->pdo->prepare("UPDATE ttrss_user_entries SET
				marked = true, last_marked = NOW()
					WHERE ref_id IN ($ids_qmarks) AND owner_uid = ?");
		} else {
			$sth = $this->pdo->prepare("UPDATE ttrss_user_entries SET
				marked = NOT marked,last_marked = NOW()
					WHERE ref_id IN ($ids_qmarks) AND owner_uid = ?");
		}

		$sth->execute([...$ids, $_SESSION['uid']]);

		PluginHost::getInstance()->run_hooks(PluginHost::HOOK_ARTICLES_MARK_TOGGLED, $ids);
	}

	/**
	 * @param array<int, int> $ids
	 */
	private function publishArticlesById(array $ids, int $cmode): void {

		$ids_qmarks = arr_qmarks($ids);

		$published_val = match($cmode) {
			Article::CATCHUP_MODE_MARK_AS_READ => 'false',
			Article::CATCHUP_MODE_MARK_AS_UNREAD => 'true',
			default => 'NOT published',
		};

		$sth = $this->pdo->prepare("UPDATE ttrss_user_entries
			SET published = {$published_val}, last_published = NOW()
			WHERE ref_id IN ($ids_qmarks) AND owner_uid = ?");

		$sth->execute([...$ids, $_SESSION['uid']]);

		PluginHost::getInstance()->run_hooks(PluginHost::HOOK_ARTICLES_PUBLISH_TOGGLED, $ids);
	}

	function log(): void {
		$msg = clean($_REQUEST['msg'] ?? "");
		$file = basename(clean($_REQUEST['file'] ?? ""));
		$line = (int) clean($_REQUEST['line'] ?? 0);
		$context = clean($_REQUEST['context'] ?? "");

		if ($msg) {
			Logger::log_error(E_USER_WARNING,
				$msg, 'client-js:' . $file, $line, $context);

			echo json_encode(["message" => "HOST_ERROR_LOGGED"]);
		}
	}

	function checkforupdates(): void {
		$rv = [
			"current_version" => (string) Config::get_version(),
			"latest_release" => null,
			"changeset" => [],
			"plugins" => [],
			"checked_at" => time(),
		];

		if (Config::get(Config::CHECK_FOR_UPDATES) === true && $_SESSION["access_level"] >= UserHelper::ACCESS_LEVEL_ADMIN) {
			$release = self::_get_latest_release();

			if ($release !== null) {
				$rv['latest_release'] = $release;

				if (self::_is_newer_release($release['tag_name'], (string) Config::get_version()) === true) {
					$rv['changeset'] = [
						'id' => $release['tag_name'],
						'timestamp' => (int) strtotime($release['published_at']),
						'compare_url' => $release['html_url'],
					];
				}
			}

			$rv["plugins"] = Pref_Prefs::_get_updated_plugins();
		}

		print json_encode($rv);
	}

	/**
	 * Latest published release of this fork, cached for an hour so that several
	 * admins polling do not run into the unauthenticated GitHub API rate limit.
	 *
	 * @return array{tag_name: string, html_url: string, published_at: string}|null
	 */
	private static function _get_latest_release(): ?array {
		$cache = new Cache_Local();
		$cache->set_dir('version');

		$release = null;
		$cached = $cache->get('latest_release.json');

		if ($cached !== null) {
			$mtime = $cache->get_mtime('latest_release.json');

			if ($mtime !== false && $mtime > time() - self::RELEASE_CHECK_TTL)
				$release = json_decode($cached, true);
		}

		if (is_array($release) === false) {
			$content = UrlHelper::fetch([
				'url' => self::RELEASES_LATEST_URL,
				'useragent' => Config::get_user_agent(),
				'http_accept' => 'application/vnd.github+json',
				'timeout' => 10,
			]);

			$release = $content !== false ? json_decode($content, true) : null;

			if (is_array($release) === true && is_string($release['tag_name'] ?? null) === true)
				$cache->put('latest_release.json', json_encode($release));
		}

		if (is_array($release) === false)
			return null;

		$tag = $release['tag_name'] ?? null;
		$html_url = $release['html_url'] ?? null;
		$published_at = $release['published_at'] ?? null;

		if (is_string($tag) === false || $tag === '')
			return null;

		return [
			'tag_name' => $tag,
			'html_url' => is_string($html_url) === true ? $html_url : '',
			'published_at' => is_string($published_at) === true ? $published_at : '',
		];
	}

	/**
	 * Only tagged releases are comparable; commit-based builds are not "behind".
	 */
	private static function _is_newer_release(string $latest, string $current): bool {
		$latest = ltrim(trim($latest), 'vV');
		$current = ltrim(trim($current), 'vV');

		if (preg_match('/^\d+(\.\d+)*$/', $latest) !== 1 || preg_match('/^\d+(\.\d+)*$/', $current) !== 1)
			return false;

		return version_compare($latest, $current, '>');
	}

	/**
	 * @return array<string, mixed>
	 */
	private function _make_init_params(): array {
		$profile = $_SESSION['profile'] ?? null;
		$params = [];

		foreach ([Prefs::ON_CATCHUP_SHOW_NEXT_FEED, Prefs::HIDE_READ_FEEDS,
			Prefs::ENABLE_FEED_CATS, Prefs::FEEDS_SORT_BY_UNREAD,
			Prefs::CONFIRM_FEED_CATCHUP,  Prefs::CDM_AUTO_CATCHUP,
			Prefs::FRESH_ARTICLE_MAX_AGE, Prefs::RECENTLY_READ_MAX_AGE, Prefs::HIDE_READ_SHOWS_SPECIAL,
			Prefs::COMBINED_DISPLAY_MODE, Prefs::DEBUG_HEADLINE_IDS, Prefs::CDM_ENABLE_GRID,
			Prefs::CDM_EXPANDED,
			// Surfaced by the Vue preferences dialog; these have no
			// other read endpoint, so without them the dialog shows
			// blank values for settings the user cannot otherwise see.
			Prefs::PURGE_OLD_DAYS, Prefs::PURGE_UNREAD_ARTICLES,
			Prefs::SHOW_CONTENT_PREVIEW, Prefs::VFEED_GROUP_BY_FEED] as $param) {

			$params[strtolower($param)] = (int) Prefs::get($param, $_SESSION['uid'], $profile);
		}

		// Digest settings are not all integers (the send time is a
		// string), so they are read with their real types rather than
		// through the int-casting loop above.
		foreach ([Prefs::DIGEST_ENABLE, Prefs::DIGEST_CATCHUP] as $param) {
			$params[strtolower($param)] = (int) Prefs::get($param, $_SESSION['uid'], $profile);
		}

		$params["digest_preferred_time"] = (string) Prefs::get(Prefs::DIGEST_PREFERRED_TIME, $_SESSION['uid'], $profile);
		$params["digest_min_score"] = (int) Prefs::get(Prefs::DIGEST_MIN_SCORE, $_SESSION['uid'], $profile);

		$params["safe_mode"] = !empty($_SESSION["safe_mode"]);
		$params["check_for_updates"] = Config::get(Config::CHECK_FOR_UPDATES);
		$params["icons_url"] = Config::get_self_url() . '/public.php';
		$params["cookie_lifetime"] = Config::get(Config::SESSION_COOKIE_LIFETIME);
		$params["default_view_mode"] = Prefs::get(Prefs::_DEFAULT_VIEW_MODE, $_SESSION['uid'], $profile);
		$params["default_view_limit"] = (int) Prefs::get(Prefs::_DEFAULT_VIEW_LIMIT, $_SESSION['uid'], $profile);
		$params["default_view_order_by"] = Prefs::get(Prefs::_DEFAULT_VIEW_ORDER_BY, $_SESSION['uid'], $profile);
		$params["bw_limit"] = (int) ($_SESSION["bw_limit"] ?? false);
		$params["is_default_pw"] = UserHelper::is_default_password();
		$params["label_base_index"] = LABEL_BASE_INDEX;

		$theme = Prefs::get(Prefs::USER_CSS_THEME, $_SESSION['uid'], $profile);
		$params["theme"] = theme_exists($theme) ? $theme : "";

		// Themes available to the Vue preferences dialog. Values are the
		// paths theme_exists()/get_theme_path() expect (relative to themes).
		$theme_dirs = ['themes'];
		$local_theme_dir = (string)Config::get(Config::LOCAL_THEMES_DIR);
		if ($local_theme_dir !== '') {
			$theme_dirs[] = $local_theme_dir;
		}

		$available_themes = [];
		foreach (array_unique($theme_dirs) as $theme_dir) {
			if (!is_dir($theme_dir)) {
				continue;
			}

			foreach (glob("$theme_dir/*.css") as $file) {
				$name = basename($file);
				if ($name !== 'local-overrides.css') {
					$available_themes[] = $name;
				}
			}

			foreach (glob("$theme_dir/*/dist/*.css") as $file) {
				$name = substr($file, strlen($theme_dir) + 1);
				if (!str_ends_with($name, 'local-overrides.css')) {
					$available_themes[] = $name;
				}
			}
		}

		sort($available_themes);
		$params["available_themes"] = array_values(array_unique($available_themes));

		$params["plugins"] = implode(", ", PluginHost::getInstance()->get_plugin_names());

		$params["php_platform"] = PHP_OS;
		$params["php_version"] = PHP_VERSION;

		$pdo = Db::pdo();

		$sth = $pdo->prepare("SELECT MAX(id) AS mid, COUNT(*) AS nf FROM
				ttrss_feeds WHERE owner_uid = ?");
		$sth->execute([$_SESSION['uid']]);
		$row = $sth->fetch();

		$max_feed_id = $row["mid"];
		$num_feeds = $row["nf"];

		$params["self_url_prefix"] = Config::get_self_url();
		$params["max_feed_id"] = (int) $max_feed_id;
		$params["num_feeds"] = (int) $num_feeds;
		$params["hotkeys"] = static::get_hotkeys_map();
		$params["widescreen"] = (int) Prefs::get(Prefs::WIDESCREEN_MODE, $_SESSION['uid'], $profile);
		$params["icon_indicator_white"] = $this->image_to_base64("images/indicator_white.gif");
		$params["icon_oval"] = $this->image_to_base64("images/oval.svg");
		$params["icon_three_dots"] = $this->image_to_base64("images/three-dots.svg");
		$params["icon_blank"] = $this->image_to_base64("images/blank_icon.gif");
		$params["labels"] = Labels::get_all($_SESSION["uid"]);

		// Every user preference with its type, so the Vue preferences dialog can
		// render the full set (the legacy Pref_Prefs page grouped them by hand).
		$prefs = [];
		foreach (Prefs::get_all($_SESSION['uid'], $profile) as $pref) {
			$prefs[$pref['pref_name']] = [
				'value' => $pref['value'],
				'type' => $pref['type_hint'],
			];
		}
		$params["prefs"] = $prefs;

		$user = ORM::for_table('ttrss_users')->find_one($_SESSION['uid']);

		$params["access_level"] = (int) ($_SESSION['access_level'] ?? 0);
		$params["is_admin"] = $params["access_level"] >= UserHelper::ACCESS_LEVEL_ADMIN;
		$params["email"] = $user ? (string) $user->email : '';
		$params["full_name"] = $user ? (string) $user->full_name : '';
		$params["otp_enabled"] = $user ? (bool) $user->otp_enabled : false;
		$params["enable_plugin_installer"] = (bool) Config::get(Config::ENABLE_PLUGIN_INSTALLER);

		return $params;
	}

	private function image_to_base64(string $filename): string {
		if (file_exists($filename)) {
			$ext = pathinfo($filename, PATHINFO_EXTENSION);

			if ($ext == "svg") $ext = "svg+xml";

			return "data:image/$ext;base64," . base64_encode((string)file_get_contents($filename));
		} else {
			return "";
		}
	}

	/**
	 * @return array<string, mixed>
	 */
	static function _make_runtime_info(): array {
		$pdo = Db::pdo();

		$sth = $pdo->prepare("SELECT MAX(id) AS mid, COUNT(*) AS nf FROM
				ttrss_feeds WHERE owner_uid = ?");
		$sth->execute([$_SESSION['uid']]);
		$row = $sth->fetch();

		$max_feed_id = $row['mid'];
		$num_feeds = $row['nf'];

		$data = [
			'max_feed_id' => (int) $max_feed_id,
			'num_feeds' => (int) $num_feeds,
			'cdm_expanded' => Prefs::get(Prefs::CDM_EXPANDED, $_SESSION['uid'], $_SESSION['profile'] ?? null),
			'labels' => Labels::get_all($_SESSION["uid"]),
		];

		if (Config::get(Config::LOG_DESTINATION) == 'sql' && $_SESSION['access_level'] >= UserHelper::ACCESS_LEVEL_ADMIN) {

			$sth = $pdo->prepare("SELECT COUNT(id) AS cid
				FROM ttrss_error_log
			WHERE
				errno NOT IN (".E_USER_NOTICE.", ".E_USER_DEPRECATED.") AND
				created_at > NOW() - INTERVAL '1 hour' AND
				errstr NOT LIKE '%Returning bool from comparison function is deprecated%' AND
				errstr NOT LIKE '%imagecreatefromstring(): Data is not in a recognized format%'");
			$sth->execute();

			if ($row = $sth->fetch()) {
				$data['recent_log_events'] = $row['cid'];
			}
		}

		if (file_exists(Config::get(Config::LOCK_DIRECTORY) . "/update_daemon.lock")) {

			$data['daemon_is_running'] = (int) file_is_locked("update_daemon.lock");

			if (time() - ($_SESSION["daemon_stamp_check"] ?? 0) > 30) {

				$stamp = (int) @file_get_contents(Config::get(Config::LOCK_DIRECTORY) . "/update_daemon.stamp");

				if ($stamp) {
					$stamp_delta = time() - $stamp;

					if ($stamp_delta > 1800) {
						$stamp_check = 0;
					} else {
						$stamp_check = 1;
						$_SESSION["daemon_stamp_check"] = time();
					}

					$data['daemon_stamp_ok'] = $stamp_check;

					$stamp_fmt = date("Y.m.d, G:i", $stamp);

					$data['daemon_stamp'] = $stamp_fmt;
				}
			}
		}

		return $data;
	}

	/**
	 * @return array<string, array<string, string>>
	 */
	static function get_hotkeys_info(): array {
		$hotkeys = [
			__("Navigation") => [
				"next_feed" => __("Open next feed"),
				"next_unread_feed" => __("Open next unread feed"),
				"prev_feed" => __("Open previous feed"),
				"prev_unread_feed" => __("Open previous unread feed"),
				"next_article_or_scroll" => __("Open next article (in combined mode, scroll down)"),
				"prev_article_or_scroll" => __("Open previous article (in combined mode, scroll up)"),
				"next_headlines_page" => __("Scroll headlines by one page down"),
				"prev_headlines_page" => __("Scroll headlines by one page up"),
				"next_article_noscroll" => __("Open next article"),
				"prev_article_noscroll" => __("Open previous article"),
				"next_article_noexpand" => __("Move to next article (don't expand)"),
				"prev_article_noexpand" => __("Move to previous article (don't expand)"),
				"search_dialog" => __("Show search dialog"),
				"cancel_search" => __("Cancel active search")],
			__("Article") => [
				"toggle_mark" => __("Toggle starred"),
				"toggle_publ" => __("Toggle published"),
				"toggle_unread" => __("Toggle unread"),
				"edit_tags" => __("Edit tags"),
				"open_in_new_window" => __("Open in new window"),
				"catchup_below" => __("Mark below as read"),
				"catchup_above" => __("Mark above as read"),
				"article_scroll_down" => __("Scroll down"),
				"article_scroll_up" => __("Scroll up"),
				"article_page_down" => __("Scroll down page"),
				"article_page_up" => __("Scroll up page"),
				"select_article_cursor" => __("Select article under cursor"),
				"email_article" => __("Email article"),
				"close_article" => __("Close/collapse article"),
				"toggle_expand" => __("Toggle article expansion (combined mode)"),
				"toggle_widescreen" => __("Toggle widescreen mode"),
				"toggle_full_text" => __("Toggle full article text via Readability")],
			__("Article selection") => [
				"select_all" => __("Select all articles"),
				"select_unread" => __("Select unread"),
				"select_marked" => __("Select starred"),
				"select_published" => __("Select published"),
				"select_invert" => __("Invert selection"),
				"select_none" => __("Deselect everything")],
			__("Feed") => [
				"feed_refresh" => __("Refresh current feed"),
				"feed_unhide_read" => __("Un/hide read feeds"),
				"feed_subscribe" => __("Subscribe to feed"),
				"feed_edit" => __("Edit feed"),
				"feed_catchup" => __("Mark as read"),
				"feed_reverse" => __("Reverse headlines"),
				"feed_toggle_vgroup" => __("Toggle headline grouping"),
				"feed_toggle_grid" => __("Toggle grid view"),
				"feed_debug_update" => __("Debug feed update"),
				"feed_debug_viewfeed" => __("Debug viewfeed()"),
				"catchup_all" => __("Mark all feeds as read"),
				"cat_toggle_collapse" => __("Un/collapse current category"),
				"toggle_cdm_expanded" => __("Toggle auto expand in combined mode"),
				"toggle_combined_mode" => __("Toggle combined mode")],
			__("Go to") => [
				"goto_all" => __("All articles"),
				"goto_fresh" => __("Fresh"),
				"goto_marked" => __("Starred"),
				"goto_published" => __("Published"),
				"goto_read" => __("Recently read"),
				"goto_prefs" => __("Preferences")],
			__("Other") => [
				"create_label" => __("Create label"),
				"create_filter" => __("Create filter"),
				"collapse_sidebar" => __("Un/collapse sidebar"),
				"help_dialog" => __("Keyboard shortcuts help")]
		];

		PluginHost::getInstance()->chain_hooks_callback(PluginHost::HOOK_HOTKEY_INFO,
			function ($result) use (&$hotkeys) {
				$hotkeys = $result;
			},
			$hotkeys);

		return $hotkeys;
	}

	/**
	 * {3} - 3 panel mode only
	 * {C} - combined mode only
	 *
	 * @return array{0: array<int, string>, 1: array<string, string>} $prefixes, $hotkeys
	 */
	static function get_hotkeys_map() {
		$hotkeys = [
			"k" => "next_feed",
			"K" => "next_unread_feed",
			"j" => "prev_feed",
			"J" => "prev_unread_feed",
			"n" => "next_article_noscroll",
			"p" => "prev_article_noscroll",
			"N" => "article_page_down",
			"P" => "article_page_up",
			"*(33)|Shift+PgUp" => "article_page_up",
			"*(34)|Shift+PgDn" => "article_page_down",
			"{3}(38)|Up" => "prev_article_or_scroll",
			"{3}(40)|Down" => "next_article_or_scroll",
			"*(38)|Shift+Up" => "article_scroll_up",
			"*(40)|Shift+Down" => "article_scroll_down",
			"^(38)|Ctrl+Up" => "prev_article_noscroll",
			"^(40)|Ctrl+Down" => "next_article_noscroll",
			"/" => "search_dialog",
			"\\" => "cancel_search",
			"s" => "toggle_mark",
			"S" => "toggle_publ",
			"u" => "toggle_unread",
			"T" => "edit_tags",
			"o" => "open_in_new_window",
			"c p" => "catchup_below",
			"c n" => "catchup_above",
			"a W" => "toggle_widescreen",
			"a e" => "toggle_full_text",
			"e" => "email_article",
			"a q" => "close_article",
			"a s" => "article_span_grid",
			"a a" => "select_all",
			"a u" => "select_unread",
			"a U" => "select_marked",
			"a p" => "select_published",
			"a i" => "select_invert",
			"a n" => "select_none",
			"f r" => "feed_refresh",
			"f a" => "feed_unhide_read",
			"f s" => "feed_subscribe",
			"f e" => "feed_edit",
			"f q" => "feed_catchup",
			"f x" => "feed_reverse",
			"f g" => "feed_toggle_vgroup",
			"f G" => "feed_toggle_grid",
			"f D" => "feed_debug_update",
			"f %" => "feed_debug_viewfeed",
			"f C" => "toggle_combined_mode",
			"f c" => "toggle_cdm_expanded",
			"Q" => "catchup_all",
			"x" => "cat_toggle_collapse",
			"g a" => "goto_all",
			"g f" => "goto_fresh",
			"g s" => "goto_marked",
			"g p" => "goto_published",
			"g r" => "goto_read",
			"g P" => "goto_prefs",
			"r" => "select_article_cursor",
			"c l" => "create_label",
			"c f" => "create_filter",
			"c s" => "collapse_sidebar",
			"?" => "help_dialog",
		];

		PluginHost::getInstance()->chain_hooks_callback(PluginHost::HOOK_HOTKEY_MAP,
			function ($result) use (&$hotkeys) {
				$hotkeys = $result;
			},
			$hotkeys);

		$prefixes = [];

		foreach (array_keys($hotkeys) as $hotkey) {
			$pair = explode(" ", (string)$hotkey, 2);

			if (count($pair) > 1 && !in_array($pair[0], $prefixes))
				$prefixes[] = $pair[0];
		}

		return [$prefixes, $hotkeys];
	}

	function hotkeyHelp(): void {
		$info = self::get_hotkeys_info();
		$imap = self::get_hotkeys_map();
		$omap = [];

		foreach ($imap[1] as $sequence => $action) {
			$omap[$action] ??= [];
			$omap[$action][] = $sequence;
		}

		?>
		<ul class='panel panel-scrollable hotkeys-help' style='height : 300px'>
		<?php

		foreach ($info as $section => $hotkeys) {
			?>
			<li><h3><?= $section ?></h3></li>
			<?php

			foreach ($hotkeys as $action => $description) {

				if (!empty($omap[$action])) {
					foreach ($omap[$action] as $sequence) {
						if (str_contains($sequence, "|")) {
							$sequence = substr($sequence,
								strpos($sequence, "|")+1,
								strlen($sequence));
						} else {
							$keys = explode(" ", $sequence);

							for ($i = 0; $i < count($keys); $i++) {
								if (strlen($keys[$i]) > 1) {
									$tmp = '';
									foreach (str_split($keys[$i]) as $c) {
										$tmp .= match ($c) {
											'*' => __('Shift') . '+',
											'^' => __('Ctrl') . '+',
											default => $c,
										};
									}
									$keys[$i] = $tmp;
								}
							}
							$sequence = join(" ", $keys);
						}

						?>
						<li>
							<div class='hk'><code><?= $sequence ?></code></div>
							<div class='desc'><?= $description ?></div>
						</li>
						<?php
					}
				}
			}
		}
		?>
		</ul>
	<footer class='text-center'>
		<?= \Controls\submit_tag(__('Close this window')) ?>
	</footer>
	<?php
	}

	/**
	 * Render the HTML a plugin hook produces. Some hooks return a string
	 * (HOOK_TOOLBAR_BUTTON) while others print directly (the main toolbar
	 * and preferences-section hooks), so both are collected.
	 *
	 * @param PluginHost::HOOK_* $hook
	 */
	/**
	 * Render a hook whose plugin method takes positional arguments.
	 *
	 * @param array<int, mixed> $args
	 */
	private function _render_plugin_hook_args(string $hook, array $args): string {
		$html = '';
		$host = PluginHost::getInstance();
		$method = strtolower($hook);

		foreach ($host->get_hooks($hook) as $plugin) {
			if (!$host->implements_hook($plugin, $hook)) {
				continue;
			}

			ob_start();

			try {
				$result = $plugin->$method(...$args);
				$html .= (string) ob_get_clean();

				if (is_string($result)) {
					$html .= $result;
				}
			} catch (\Throwable $err) {
				ob_end_clean();
				Debug::log("plugin hook $hook failed: " . $err->getMessage());
			}
		}

		return $html;
	}
	private function _render_plugin_hook(string $hook, ?string $section = null): string {
		$html = '';
		$host = PluginHost::getInstance();
		$method = strtolower($hook);

		foreach ($host->get_hooks($hook) as $plugin) {
			if (!$host->implements_hook($plugin, $hook)) {
				continue;
			}

			ob_start();

			try {
				$result = $section === null ? $plugin->$method() : $plugin->$method($section);
				$html .= (string) ob_get_clean();

				if (is_string($result)) {
					$html .= $result;
				}
			} catch (\Throwable $err) {
				ob_end_clean();
				Debug::log("plugin hook $hook failed: " . $err->getMessage());
			}
		}

		return $html;
	}

	/** HTML for the plugin-provided main and action toolbar buttons. */
	function getPluginButtons(): void {
		$custom_sort_map = [];

		PluginHost::getInstance()->run_hooks_callback(PluginHost::HOOK_HEADLINES_CUSTOM_SORT_MAP,
			function ($result) use (&$custom_sort_map) {
				if (is_array($result)) {
					$custom_sort_map = array_merge($custom_sort_map, $result);
				}
			});

		$feed = (int) ($_REQUEST['feed'] ?? 0);
		$is_cat = self::_param_to_bool($_REQUEST['is_cat'] ?? false);

		print json_encode([
			'main_toolbar' => $this->_render_plugin_hook(PluginHost::HOOK_MAIN_TOOLBAR_BUTTON),
			'toolbar' => $this->_render_plugin_hook(PluginHost::HOOK_TOOLBAR_BUTTON),
			'feed_tree' => $this->_render_plugin_hook(PluginHost::HOOK_FEED_TREE),
			'action_items' => $this->_render_plugin_hook(PluginHost::HOOK_ACTION_ITEM),
			'headline_toolbar' => $feed > 0
				? $this->_render_plugin_hook_args(PluginHost::HOOK_HEADLINE_TOOLBAR_BUTTON, [$feed, $is_cat])
				: '',
			// HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2 renders <option> elements
			// for the legacy Select dropdown. Only call it for a concrete feed:
			// the startup request has no feed and some plugins assume one.
			'headline_menu_items' => $feed > 0
				? $this->_render_plugin_hook_args(PluginHost::HOOK_HEADLINE_TOOLBAR_SELECT_MENU_ITEM2, [$feed, $is_cat])
				: '',
			'custom_sort_map' => $custom_sort_map,
		]);
	}

	/** HTML for one plugin-provided preferences section. */
	/**
	 * Plugin-provided preference tabs (HOOK_PREFS_TAB).
	 *
	 * Each plugin decides which legacy tab it belongs to, so the hook is
	 * invoked once per known tab id and only non-empty answers are returned.
	 */
	function getPluginPrefsTabs(): void {
		$tabs = [];
		$host = PluginHost::getInstance();
		$method = 'hook_prefs_tab';

		foreach (['prefPrefs', 'prefFeeds', 'prefFilters', 'prefLabels', 'prefUsers', 'prefSystem'] as $section) {
			if (in_array($section, ['prefUsers', 'prefSystem']) &&
					($_SESSION['access_level'] ?? 0) < UserHelper::ACCESS_LEVEL_ADMIN) {
				continue;
			}

			foreach ($host->get_hooks(PluginHost::HOOK_PREFS_TAB) as $plugin) {
				if (!$host->implements_hook($plugin, PluginHost::HOOK_PREFS_TAB)) {
					continue;
				}

				ob_start();

				try {
					$plugin->$method($section);
					$html = trim((string) ob_get_clean());
				} catch (\Throwable $err) {
					ob_end_clean();
					Debug::log("plugin prefs tab $section failed: " . $err->getMessage());
					continue;
				}

				if ($html === '') {
					continue;
				}

				$title = $section;

				if (preg_match('/<div\b[^>]*\btitle="([^"]*)"/i', $html, $match)) {
					$title = trim(strip_tags($match[1]));
				}

				$tabs[] = [
					'id' => $section . '-' . strtolower($plugin::class),
					'section' => $section,
					'plugin' => $plugin::class,
					'title' => $title,
					'html' => $html,
				];
			}
		}

		print json_encode(['tabs' => $tabs]);
	}

	function getPluginPrefsSection(): void {
		$section = clean((string) ($_REQUEST['section'] ?? ''));

		print json_encode([
			'html' => $this->_render_plugin_hook(PluginHost::HOOK_PREFS_TAB_SECTION, $section),
		]);
	}

}
