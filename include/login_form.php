<?php startup_gettext(); ?>
<!DOCTYPE html>
<html>
<head>
	<title>Tiny Tiny RSS : Login</title>
	<link rel="shortcut icon" type="image/png" href="images/favicon.png">
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
	<meta name="viewport" content="initial-scale=1,width=device-width" />
	<?php
	foreach (["js/common.js",
				"js/utility.js"] as $jsfile) {

		echo javascript_tag($jsfile);

	} ?>

	<?= Config::get_override_links() ?>

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
	</script>

	<script type="text/javascript">
	/* exported Plugins */
	const Plugins = {};

	<?php
		foreach (PluginHost::getInstance()->get_plugins() as $n => $p) {
			$script = $p->get_login_js();

			if ($script) {
				echo "try {
						$script
				} catch (e) {
											console.warn('failed to initialize plugin JS: $n', e);
									}";
			}
		}
	?>
	</script>
</head>

<body class="flat ttrss_utility ttrss_login css_loading">

<script type="text/javascript">
	const UtilityApp = {
	previousLogin: "",
	    init: function() { /* invoked by UtilityJS */
		const bw_limit = document.getElementById("bw_limit");
		if (bw_limit) bw_limit.checked = Cookie.get("ttrss_bwlimit") == 'true';

		const login = document.getElementById("login");
		if (login) login.focus();
	    },
	fetchProfiles: function() {
		const login = document.getElementById("login").value;

		if (login && login != this.previousLogin) {
		this.previousLogin = login;

		xhr.json("public.php", {op: "getprofiles", login: login},
		    (reply) => {
			const profile = document.getElementById('profile');

			while (profile.options.length > 0) profile.remove(0);

			reply.forEach((p) => {
			    profile.disabled = false;
			    const option = document.createElement("option");
			    option.textContent = p;
			    profile.appendChild(option);
			});
		    });
	    }
	    },
	gotoRegForm: function() {
		window.location.href = "register.php";
		return false;
	},
	bwLimitChange: function(elem) {
		Cookie.set("ttrss_bwlimit", elem.checked,
				<?php print Config::get(Config::SESSION_COOKIE_LIFETIME) ?>);
	    }
    };

</script>

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
				<label><?= __("Login:") ?></label>
				<input name="login" id="login" type="text"
					autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
					onchange="UtilityApp.fetchProfiles()"
					onfocus="UtilityApp.fetchProfiles()"
					onblur="UtilityApp.fetchProfiles()"
					<?= Config::get(Config::DISABLE_LOGIN_FORM) ? 'disabled="disabled"' : '' ?>
					required="1" value="<?= $_SESSION["fake_login"] ?? "" ?>" />
			</fieldset>

			<fieldset>
				<label><?= __("Password:") ?></label>

				<input type="password" name="password" required="1"
					autocomplete="current-password"
					class="input input-text"
					onchange="UtilityApp.fetchProfiles()"
					onfocus="UtilityApp.fetchProfiles()"
					onblur="UtilityApp.fetchProfiles()"
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
					<label><?= __("Profile:") ?></label>

					<select disabled='disabled' name="profile" id="profile">
						<option><?= __("Default profile") ?></option>
					</select>
				</fieldset>

				<fieldset class="narrow">
					<label> </label>

					<label id="bw_limit_label">
						<?= \Controls\checkbox_tag("bw_limit", false, "",
								["onchange" => 'UtilityApp.bwLimitChange(this)'], 'bw_limit') ?>
						<?= __("Use less traffic") ?></label>
				</fieldset>

				<fieldset class="narrow">
					<label> </label>

					<label id="safe_mode_label">
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
