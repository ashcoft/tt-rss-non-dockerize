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
