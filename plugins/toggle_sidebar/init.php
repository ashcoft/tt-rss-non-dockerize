<?php
class Toggle_Sidebar extends Plugin {

	function about() {
		return [null,
			"Adds a main toolbar button to toggle sidebar",
			"fox"];
	}

	function init($host) {
		$host->add_hook($host::HOOK_MAIN_TOOLBAR_BUTTON, $this);
	}


	function api_version() {
		return 2;
	}

}
