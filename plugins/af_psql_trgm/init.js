/* global Plugins, xhr, __, fox */

Plugins.Psql_Trgm = {
	showRelated: function (id) {
		const dialog = new fox.SingleUseDialog({
			title: __("Related articles"),
			content: __("Loading, please wait...")
		});

		dialog.connect("onShow", function (/* e */) {
			xhr.post("backend.php", {op: 'PluginHandler', plugin: 'af_psql_trgm', method: 'showrelated', id: id}, (reply) => {
				dialog.attr('content', reply);
			});
		});

		dialog.show();
	}
};
