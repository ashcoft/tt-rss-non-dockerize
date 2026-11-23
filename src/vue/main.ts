/**
 * Tiny Tiny RSS - Vue 3 Application Entry Point
 * 
 * This is the main entry point for the Vue 3 + Vuetify migration.
 * It bootstraps the Vue application and mounts it to the DOM.
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createVuetify } from 'vuetify';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import App from './App.vue';
import { api } from './api/client';

// Create Pinia state management
const pinia = createPinia();

// Feedly is this fork's default theme. The light palette follows the Feedly
// theme's base colours; the night variant mirrors feedly_night.css.
const vuetify = createVuetify({
  theme: {
    defaultTheme: 'feedly',
    themes: {
      feedly: {
        dark: false,
        colors: {
          background: '#f4f4f4',
          surface: '#ffffff',
          primary: '#3399cc',
          secondary: '#66bb55',
          error: '#dd4455',
          info: '#3399cc',
          success: '#66bb55',
          warning: '#ee8844',
          'on-background': '#333333',
          'on-surface': '#222222',
        },
      },
      feedlyNight: {
        dark: true,
        colors: {
          background: '#303030',
          surface: '#3a3a3a',
          primary: '#3399cc',
          secondary: '#66bb55',
          error: '#dd4455',
          info: '#3399cc',
          success: '#66bb55',
          warning: '#ee8844',
          'on-background': '#dddddd',
          'on-surface': '#eeeeee',
        },
      },
    },
  },
});

// Initialize API client with CSRF token from backend. A failure here is not
// fatal: the adapter fetches the token on demand before the first request.
try {
  await api.initCsrfToken();
} catch (err) {
  console.warn('[Vue 3] CSRF token unavailable; requests will retry on demand.', err);
}

// Create Vue app instance
const app = createApp(App);

// Use Pinia state management
app.use(pinia);

// Use Vuetify UI framework
app.use(vuetify);

// Mount the app
// The app will be mounted to the element with id="vue-app"
// This allows for gradual migration - the Dojo app can coexist with Vue components
const mountPoint = document.getElementById('vue-app');

if (mountPoint) {
  app.mount('#vue-app');
} else {
  console.warn('[Vue 3] Mount point #vue-app not found. Vue components will be available for lazy loading.');
}

// Export app instance for debugging
export default app;
