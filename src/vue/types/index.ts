/**
 * Type definitions for Tiny Tiny RSS Vue components
 * 
 * Note: These are shared types. Store-specific types with additional
 * properties should be defined locally in each store file.
 */

export interface Feed {
  id: number;
  title: string;
  unread?: number;
  cat_id?: number | null;
  feed_url?: string;
  icon?: string;
  site_url?: string;
  /** True when the backend has a cached favicon for this feed. */
  has_icon?: boolean;
  /** The feed's last update error, or "". */
  error?: string;
  /** The feed's last update time as the backend formatted it. */
  updated?: string;
}

export interface Category {
  id: number;
  title: string;
  unread?: number;
  parent_id?: number | null;
}

export interface Label {
  id: number;
  caption: string;
  unread?: number;
  fg_color?: string;
  bg_color?: string;
}

export interface Headline {
  id: number;
  guid: string;
  title: string;
  link: string;
  content: string;
  excerpt: string;
  updated: string;
  updated_long?: string;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
  labels?: unknown[];
  feed_id: number;
  feed_title: string;
  comments_count: number;
  comments_link: string;
  author: string;
  score: number;
  note: string;
  /** The feed's site URL reported on the headline row. */
  feed_site_url?: string;
  /** True when the headline's feed has a cached icon. */
  feed_has_icon?: boolean;
  /** Content language, used as the legacy `lang` attribute. */
  lang?: string;
  /** Localized import date shown as the row tooltip. */
  imported?: string;
  /** Thumbnail URL shown as a preview in combined mode, if any. */
  image_preview?: string;
  /** The feed's background colour, used to tint its label in combined mode. */
  feed_bg_color?: string;
  /** Plugin-provided buttons rendered on the left of the row. */
  pluginLeftButtons?: Array<{ plugin: string; method: string; icon: string; title: string }>;
  /** Plugin-provided article buttons (from HOOK_ARTICLE_BUTTON). */
  pluginButtons?: Array<{ plugin: string; method: string; icon: string; title: string }>;
}

export interface Article {
  id: number;
  guid: string;
  title: string;
  link: string;
  content: string;
  excerpt: string;
  updated: string;
  updated_long?: string;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
  labels?: unknown[];
  feed_id: number;
  feed_title: string;
  comments_count: number;
  comments_link: string;
  author: string;
  score: number;
  note: string;
  /** Attachments (podcast audio, video, files) offered by the reading pane. */
  enclosures?: Array<{
    content_url: string;
    content_type: string;
    title: string;
    duration: string;
    width: number;
    height: number;
  }>;
  /** Thumbnail URL shown as a preview in combined mode, if any. */
  image_preview?: string;
  /** The feed's background colour, used to tint its label in combined mode. */
  feed_bg_color?: string;
  /** Plugin-provided article buttons (from HOOK_ARTICLE_BUTTON). */
  pluginButtons?: Array<{ plugin: string; method: string; icon: string; title: string }>;
}

export interface FeedTreeNode {
  id: string;
  name: string;
  type: 'feed' | 'category' | 'label';
  unread: number;
  children?: FeedTreeNode[];
  icon?: string;
}

export interface ApiResponse<T = unknown> {
  status: number;
  content: T;
  message?: string;
}
