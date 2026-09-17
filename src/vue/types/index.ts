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
  updated: number;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
  feed_id: number;
  feed_title: string;
  comments_count: number;
  comments_link: string;
  author: string;
  score: number;
  note: string;
}

export interface Article {
  id: number;
  guid: string;
  title: string;
  link: string;
  content: string;
  excerpt: string;
  updated: number;
  is_marked: boolean;
  is_read: boolean;
  is_published: boolean;
  tags: string[];
  feed_id: number;
  feed_title: string;
  comments_count: number;
  author: string;
  note: string;
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
