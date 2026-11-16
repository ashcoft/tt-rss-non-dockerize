<?php
class Af_Psql_Trgm extends Plugin {

	/** @var PluginHost $host */
	private $host;

	/** @var float */
	private $default_similarity = 0.75;

	/** @var int */
	private $default_min_length = 32;

	function about() {
		return [null,
			"Marks similar articles as read (requires pg_trgm)",
			"fox"];
	}

	/** @return void */
	function save() {
		$similarity = (float) $_POST["similarity"];
		$min_title_length = (int) $_POST["min_title_length"];
		$enable_globally = checkbox_to_sql_bool($_POST["enable_globally"] ?? "");

		if ($similarity < 0) $similarity = 0;
		if ($min_title_length < 0) $min_title_length = 0;

		$similarity = sprintf("%.2f", $similarity);

		$this->host->set($this, "similarity", $similarity);
		$this->host->set($this, "min_title_length", $min_title_length);
		$this->host->set($this, "enable_globally", $enable_globally);

		echo T_sprintf("Data saved (%s, %d)", $similarity, $enable_globally);
	}

	function init($host) {
		$this->host = $host;

		$host->add_hook($host::HOOK_ARTICLE_FILTER, $this);
		$host->add_hook($host::HOOK_PREFS_TAB, $this);
		$host->add_hook($host::HOOK_PREFS_EDIT_FEED, $this);
		$host->add_hook($host::HOOK_PREFS_SAVE_FEED, $this);
		$host->add_hook($host::HOOK_ARTICLE_BUTTON, $this);
	}


	function hook_article_button($line) {
		return "<i style=\"cursor : pointer\" class='material-icons'
			onclick=\"Plugins.Psql_Trgm.showRelated(".$line["id"].")\"
			title=\"".__('Show related articles')."\">bookmark_outline</i>";
	}

	function hook_prefs_tab($args) {
		if ($args != "prefFeeds") return;

		$similarity = $this->host->get($this, "similarity", $this->default_similarity);
		$min_title_length = $this->host->get($this, "min_title_length", $this->default_min_length);
		$enable_globally = sql_bool_to_bool($this->host->get($this, "enable_globally"));

		?>

		<div
			title="<i class='material-icons'>extension</i> <?= __('Mark similar articles as read (af_psql_trgm)') ?>">

			<?php
			$res = $this->pdo->query("select 'similarity'::regproc");

			if (!$res || !$res->fetch()) {
				print_error("pg_trgm extension not found.");
			} ?>

			<form>

				<?= \Controls\pluginhandler_tags($this, "save") ?>

				<script type="dojo/method" event="onSubmit" args="evt">
					evt.preventDefault();
					if (this.validate()) {
						Notify.progress('Saving data...', true);
						xhr.post("backend.php", this.getValues(), (reply) => {
							Notify.info(reply);
						})
					}
				</script>

				<?= format_notice("Enable for specific feeds in the feed editor.") ?>

				<fieldset>
					<label><?= __("Minimum similarity:") ?></label>
					<input
						placeholder="<?= $this->default_similarity ?>"
						id='psql_trgm_similarity'
						required="1"
						name="similarity" value="<?= htmlspecialchars($similarity) ?>">

					<div connectId='psql_trgm_similarity' position='below'>
						<?= __("PostgreSQL trigram extension returns string similarity as a floating point number (0-1). Setting it too low might produce false positives, zero disables checking.") ?>
					</div>
				</fieldset>

				<fieldset>
					<label><?= __("Minimum title length:") ?></label>
					<input
						placeholder="<?= $this->default_min_length ?>"
						required="1"
						name="min_title_length" value="<?= htmlspecialchars($min_title_length) ?>">
				</fieldset>

				<fieldset>
					<label class='checkbox'>
						<?= \Controls\checkbox_tag("enable_globally", $enable_globally) ?>
						<?= __("Enable for all feeds.") ?>
					</label>
				</fieldset>

				<hr/>

				<?= \Controls\submit_tag(__("Save")) ?>
			</form>

			<?php
				/* cleanup */
				$enabled_feeds = $this->filter_unknown_feeds(
					$this->host->get_array($this, "enabled_feeds"));

				$this->host->set($this, "enabled_feeds", $enabled_feeds);
			?>

			<?php	if (count($enabled_feeds) > 0) {	?>
				<hr/>
				<h3><?= __("Currently enabled for (click to edit):") ?></h3>

				<ul class="panel panel-scrollable list list-unstyled">
					<?php foreach ($enabled_feeds as $f) { ?>
						<li>
							<i class='material-icons'>rss_feed</i>
							<a href='#'	onclick="CommonDialogs.editFeed(<?= $f ?>)">
									<?= Feeds::_get_title($f, $_SESSION['uid']) ?>
							</a>
						</li>
					<?php } ?>
				</ul>
			<?php	} ?>
		</div>
		<?php
	}

	function hook_prefs_edit_feed($feed_id) {
			$enabled_feeds = $this->host->get_array($this, "enabled_feeds");
		?>
			<header><?= __("Similarity (af_psql_trgm)") ?></header>

			<section>
				<fieldset>
					<label class="checkbox">
						<?= \Controls\checkbox_tag("trgm_similarity_enabled", in_array($feed_id, $enabled_feeds)) ?>
						<?= __('Mark similar articles as read') ?>
					</label>
				</fieldset>
			</section>
		</section>
		<?php
	}

	function hook_prefs_save_feed($feed_id) {
		$enabled_feeds = $this->host->get_array($this, "enabled_feeds");

		$enable = checkbox_to_sql_bool($_POST["trgm_similarity_enabled"] ?? "");
		$key = array_search($feed_id, $enabled_feeds);

		if ($enable) {
			if ($key === false)
				$enabled_feeds[] = $feed_id;
		} else {
			if ($key !== false)
				unset($enabled_feeds[$key]);
		}

		$this->host->set($this, "enabled_feeds", $enabled_feeds);
	}

	function hook_article_filter($article) {

		$res = $this->pdo->query("select 'similarity'::regproc");
		if (!$res || !$res->fetch()) return $article;

		$enable_globally = $this->host->get($this, "enable_globally");

		if (!$enable_globally &&
				!in_array($article["feed"]["id"],
					$this->host->get_array($this,"enabled_feeds"))) {

			return $article;
		}

		$similarity = (float) $this->host->get($this, "similarity", $this->default_similarity);

		if ($similarity < 0.01) {
			Debug::log("af_psql_trgm: similarity is set too low ($similarity)", Debug::LOG_EXTENDED);
			return $article;
		}

		$min_title_length = (int) $this->host->get($this, "min_title_length", $this->default_min_length);

		if (mb_strlen($article["title"]) < $min_title_length) {
			Debug::log("af_psql_trgm: article title is too short (min: $min_title_length)", Debug::LOG_EXTENDED);
			return $article;
		}

		$owner_uid = $article["owner_uid"];
		$entry_guid = $article["guid_hashed"];
		$title_escaped = $article["title"];

		// trgm does not return similarity=1 for completely equal strings
		// this seems to be no longer the case (fixed in upstream?)

		/* $sth = $this->pdo->prepare("SELECT COUNT(id) AS nequal
		  FROM ttrss_entries, ttrss_user_entries WHERE ref_id = id AND
		  date_entered >= NOW() - interval '3 days' AND
		  title = ? AND
		  guid != ? AND
		  owner_uid = ?");
		$sth->execute([$title_escaped, $entry_guid, $owner_uid]);

		$row = $sth->fetch();
		$nequal = $row['nequal'];

		Debug::log("af_psql_trgm: num equals: $nequal", Debug::$LOG_EXTENDED);

		if ($nequal != 0) {
			$article["force_catchup"] = true;
			return $article;
		} */

		$sth = $this->pdo->prepare("SELECT MAX(SIMILARITY(title, :title)) AS ms
			FROM ttrss_entries, ttrss_user_entries WHERE ref_id = id AND
			date_entered >= NOW() - interval '1 day' AND
			guid != :guid AND
			owner_uid = :uid");

		$sth->execute(['title' => $title_escaped, 'guid' => $entry_guid, 'uid' => $owner_uid]);

		$row = $sth->fetch();
		$similarity_result = $row['ms'];

		Debug::log("af_psql_trgm: similarity result for $title_escaped: $similarity_result", Debug::LOG_EXTENDED);

		if ($similarity_result >= $similarity) {
			Debug::log("af_psql_trgm: marking article as read ($similarity_result >= $similarity)", Debug::LOG_EXTENDED);

			$article["force_catchup"] = true;
		}

		return $article;
	}

	function api_version() {
		return 2;
	}

	/**
	 * @param array<int> $enabled_feeds
	 * @return array<int>
	 * @throws PDOException
	 */
	private function filter_unknown_feeds($enabled_feeds) : array {
		$tmp = [];

		foreach ($enabled_feeds as $feed) {
			$sth = $this->pdo->prepare("SELECT id FROM ttrss_feeds WHERE id = ? AND owner_uid = ?");
			$sth->execute([$feed, $_SESSION['uid']]);

			if ($sth->fetch())
				$tmp[] = $feed;
		}

		return $tmp;
	}
}
