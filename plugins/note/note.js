/* global Plugins, PluginHost, xhr, App, Notify, fox, __ */

Plugins.Note = {
	set_click_handler: function() {
		document.querySelectorAll('.article-note[data-note-for]').forEach((note) => {
			note.onclick = function() {
				Plugins.Note.edit(this.getAttribute('data-note-for'));
			}
		});
	},
	edit: function(id) {
		const dialog = new fox.SingleUseDialog({
			title: __("Edit article note"),
			execute: function () {
				Notify.progress("Saving article note...", true);

				xhr.json("backend.php", dialog.attr('value'), (reply) => {
					Notify.close();
					dialog.hide();

					if (reply) {
						document.querySelectorAll(`div[data-note-for="${reply.id}"]`).forEach((elem) => {
							const body = elem.querySelector('.body');
							if (body) body.innerHTML = reply.note;
							reply.note ? elem.show() : elem.hide();
						});
					}
				});
			},
			content: __("Loading, please wait...")
		});

		dialog.connect('onShow', function () {
			xhr.post("backend.php", App.getPhArgs("note", "edit", {id: id}), (reply) => {
				dialog.attr('content', reply);
			});
		});

		dialog.show();
	}
};

PluginHost.register(PluginHost.HOOK_HEADLINES_RENDERED, () => {
	Plugins.Note.set_click_handler();
});
