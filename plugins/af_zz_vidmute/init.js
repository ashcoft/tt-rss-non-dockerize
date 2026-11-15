/* global PluginHost */

function mute(row) {
	[...row.querySelectorAll("video")].forEach((vid) => { vid.muted = true; });
}

PluginHost.register(PluginHost.HOOK_ARTICLE_RENDERED_CDM, function (row) {
	mute(row);
	return true;
});

PluginHost.register(PluginHost.HOOK_ARTICLE_RENDERED, function (row) {
	mute(row);
	return true;
});
