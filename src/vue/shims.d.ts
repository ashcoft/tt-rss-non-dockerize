declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}

declare module '*.css' {
  const content: Record<string, unknown>;
  export default content;
}

declare module '*.less' {
  const content: Record<string, unknown>;
  export default content;
}

// Shell globals injected by include/app_shell.php.
interface Window {
  __csrf_token?: string;
  __ttrss_user?: string;
  __ttrss_view?: string;
  __ttrss_prefs_tab?: string;
  __default_light_theme?: string;
  __default_dark_theme?: string;
}
