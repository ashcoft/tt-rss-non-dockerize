/** Material-icon names plugins emit mapped onto the MDI set the app uses. */
const PLUGIN_ICONS: Record<string, string> = {
  note: 'mdi-note-edit-outline',
  link: 'mdi-link-variant',
  bookmark_outline: 'mdi-bookmark-outline',
  description: 'mdi-text-box-outline',
  share: 'mdi-share-variant',
  print: 'mdi-printer',
};

export function pluginIcon(icon: string): string {
  return PLUGIN_ICONS[icon] ?? 'mdi-extension';
}
