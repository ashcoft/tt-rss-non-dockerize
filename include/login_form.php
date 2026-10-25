<?php startup_gettext(); ?>
<!DOCTYPE html>
<html>
<head>
	<title>Tiny Tiny RSS : Login</title>
	<link rel="shortcut icon" type="image/png" href="images/favicon.png">
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
	<meta name="viewport" content="initial-scale=1,width=device-width" />

	<?= Config::get_override_links() ?>

	<?= stylesheet_tag("themes/light.css") ?>

	<style type="text/css">
		@media (prefers-color-scheme: dark) {
			body {
				background : #303030;
			}
		}

		body.css_loading * {
			display : none;
		}
	</style>

	<script type="text/javascript">
		const __default_light_theme = "<?= get_theme_path(Config::get(Config::DEFAULT_LIGHT_THEME), 'themes/light.css') ?>";
		const __default_dark_theme = "<?= get_theme_path(Config::get(Config::DEFAULT_DARK_THEME), 'themes/night.css') ?>";

		/** Minimal cookie helper (the Dojo utility bundle is no longer loaded). */
		const Cookie = {
			set: function (name, value, lifetime) {
				const d = new Date();
				d.setTime(d.getTime() + lifetime * 1000);
				document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + d.toUTCString();
			},
			get: function (name) {
				const prefix = name + "=";
				for (const part of document.cookie.split(";")) {
					const entry = part.trim();
					if (entry.indexOf(prefix) === 0) return decodeURIComponent(entry.substring(prefix.length));
				}
				return "";
			},
		};

		/**
			 * Profile lookup and the bandwidth cookie used to be driven by dijit.
			 * The form is plain HTML now, so this is the only JavaScript the page
			 * needs and it does not load Dojo at all.
			 */
		const LoginPage = {
			previousLogin: "",

			init: function () {
				document.body.classList.remove("css_loading");

				const bwLimit = document.getElementById("bw_limit");
				if (bwLimit)
					bwLimit.checked = Cookie.get("ttrss_bwlimit") === "true";

				const login = document.getElementById("login");
				if (login) login.focus();
			},

			fetchProfiles: function () {
				const login = document.getElementById("login");
				const profile = document.getElementById("profile");
				if (!login || !profile || !login.value || login.value === this.previousLogin) return;

				this.previousLogin = login.value;

				const body = new URLSearchParams({ op: "getprofiles", login: login.value });

				fetch("public.php", {
					method: "POST",
					credentials: "include",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: body.toString(),
				})
					.then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
					.then((profiles) => {
						profile.replaceChildren();
						for (const entry of profiles) {
							const option = document.createElement("option");
							option.value = String(entry.value);
							option.textContent = entry.label;
							profile.append(option);
						}
						profile.disabled = profiles.length === 0;
					})
					.catch((error) => console.warn("failed to load profiles", error));
			},

			bwLimitChange: function (element) {
				Cookie.set("ttrss_bwlimit", element.checked,
					<?php print (int) Config::get(Config::SESSION_COOKIE_LIFETIME) ?>);
			},
		};

		document.addEventListener("DOMContentLoaded", () => LoginPage.init());
	</script>
</head>

<body class="flat ttrss_utility ttrss_login css_loading">

<?php $return = urlencode(!empty($_REQUEST['return']) ? $_REQUEST['return'] : with_trailing_slash(Config::get_self_url())) ?>

<div class="container">

	<h1><?= "Authentication" ?></h1>
	<div class="content">
		<form action="public.php?return=<?= $return ?>" method="POST">

			<?= \Controls\hidden_tag("op", "login"); ?>

			<?php if (!empty($_SESSION["login_error_msg"])) { ?>
				<?= format_error($_SESSION["login_error_msg"]) ?>
				<?php $_SESSION["login_error_msg"] = ""; ?>
			<?php } ?>

			<fieldset>
				<label for="login"><?= __("Login:") ?></label>
				<input name="login" id="login" type="text"
					autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
					onchange="LoginPage.fetchProfiles()"
					onfocus="LoginPage.fetchProfiles()"
					onblur="LoginPage.fetchProfiles()"
					<?= Config::get(Config::DISABLE_LOGIN_FORM) ? 'disabled="disabled"' : '' ?>
					required="1" value="<?= $_SESSION["fake_login"] ?? "" ?>" />
			</fieldset>

			<fieldset>
				<label for="password"><?= __("Password:") ?></label>

				<input type="password" name="password" id="password" required="1"
					autocomplete="current-password"
					class="input input-text"
					onchange="LoginPage.fetchProfiles()"
					onfocus="LoginPage.fetchProfiles()"
					onblur="LoginPage.fetchProfiles()"
					<?= Config::get(Config::DISABLE_LOGIN_FORM) ? 'disabled="disabled"' : '' ?>
					value="<?= $_SESSION["fake_password"] ?? "" ?>"/>
			</fieldset>
			<?php if (!Config::get(Config::DISABLE_LOGIN_FORM) && str_contains(Config::get(Config::PLUGINS), "auth_internal")) { ?>
				<fieldset class="align-right">
					<a href="public.php?op=forgotpass"><?= __("I forgot my password") ?></a>
				</fieldset>
			<?php } ?>

			<?php if (!Config::get(Config::DISABLE_LOGIN_FORM)) { ?>
				<fieldset>
					<label for="profile"><?= __("Profile:") ?></label>

					<select name="profile" id="profile">
						<option value="0"><?= __("Default profile") ?></option>
					</select>
				</fieldset>

				<fieldset class="narrow">
					<label> </label>

					<label id="bw_limit_label" title="<?= __("Does not display images in articles, reduces automatic refreshes."); ?>">
						<?= \Controls\checkbox_tag("bw_limit", false, "",
								["onchange" => 'LoginPage.bwLimitChange(this)'], 'bw_limit') ?>
						<?= __("Use less traffic") ?></label>
				</fieldset>

				<fieldset class="narrow">
					<label> </label>

					<label id="safe_mode_label" title="<?= __("Uses default theme and prevents all plugins from loading."); ?>">
						<?= \Controls\checkbox_tag("safe_mode") ?>
						<?= __("Safe mode") ?>
					</label>
				</fieldset>

				<?php if (Config::get(Config::SESSION_COOKIE_LIFETIME) > 0) { ?>
					<fieldset class="narrow">
						<label> </label>
						<label>
							<?= \Controls\checkbox_tag("remember_me") ?>
							<?= __("Remember me") ?>
						</label>
					</fieldset>
				<?php } ?>
			<?php } ?>

			<hr/>

			<fieldset class="align-right">
				<label> </label>
				<?php if (!Config::get(Config::DISABLE_LOGIN_FORM)) { ?>
				<?= \Controls\submit_tag(__('Log in')) ?>
				<?php } ?>
				<?php PluginHost::getInstance()->run_hooks(PluginHost::HOOK_LOGINFORM_ADDITIONAL_BUTTONS) ?>
			</fieldset>

		</form>
	</div>

	<div class="footer">
		<a href="https://github.com/tt-rss/tt-rss">Tiny Tiny RSS</a>
	</div>

</div>

</body>
</html>
