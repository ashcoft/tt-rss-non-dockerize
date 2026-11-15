/**
 * Tiny Tiny RSS - Vue 3 Preferences Entry Point
 *
 * Bootstraps the preferences application (prefs.php). It shares the transport
 * and Pinia stores with the main app but mounts a tabbed preferences UI.
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createVuetify } from 'vuetify';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import PrefsApp from './PrefsApp.vue';
import { api } from './api/client';

const pinia = createPinia();

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
  },
});

try {
  await api.initCsrfToken();
} catch (err) {
  console.warn('[Vue 3] CSRF token unavailable; requests will retry on demand.', err);
}

const app = createApp(PrefsApp);

app.use(pinia);
app.use(vuetify);
app.mount('#vue-app');

export default app;
