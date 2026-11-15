/* global Headlines */

// The legacy client read this flag when sorting the headlines list; the Vue
// store reads it too (see headlines.ts), so a plugin can still force the
// default sort order to put newer articles on top.
if (typeof Headlines !== "undefined") {
	Headlines.default_force_to_top = true;
}
