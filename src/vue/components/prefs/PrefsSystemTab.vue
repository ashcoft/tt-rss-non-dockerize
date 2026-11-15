<template>
  <div>
    <v-expansion-panels variant="accordion">
      <v-expansion-panel v-if="logEnabled" @group:selected="loadLog">
        <v-expansion-panel-title>
          <v-icon start>mdi-alert-circle-outline</v-icon> Event log
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex gap-2 mb-3 align-center flex-wrap">
            <v-btn size="small" variant="tonal" @click="loadLog">Refresh</v-btn>
            <v-btn size="small" variant="tonal" :disabled="logPage <= 0" @click="gotoPage(logPage - 1)">
              &lt;&lt;
            </v-btn>
            <span class="text-caption">Page {{ logPage + 1 }} of {{ logTotalPages + 1 }}</span>
            <v-btn size="small" variant="tonal" :disabled="logPage >= logTotalPages" @click="gotoPage(logPage + 1)">
              &gt;&gt;
            </v-btn>
            <v-btn size="small" variant="tonal" color="error" @click="clearLog">Clear</v-btn>
            <v-spacer />
            <v-select
              v-model="severity"
              :items="severityOptions"
              label="Severity"
              density="compact"
              variant="outlined"
              hide-details
              class="severity-select"
              @update:model-value="loadLog"
            />
          </div>

          <v-table density="compact">
            <thead>
              <tr>
                <th>Error</th>
                <th>Filename</th>
                <th>Message</th>
                <th>User</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(entry, index) in logEntries" :key="index">
                <td>{{ entry.errno_name }} ({{ entry.errno }})</td>
                <td>{{ entry.filename }}:{{ entry.lineno }}</td>
                <td class="log-message">{{ entry.errstr }} {{ entry.context }}</td>
                <td>{{ entry.login }}</td>
                <td>{{ entry.created_at }}</td>
              </tr>
              <tr v-if="logEntries.length === 0">
                <td colspan="5" class="text-grey text-center">No log entries.</td>
              </tr>
            </tbody>
          </v-table>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-title>
          <v-icon start>mdi-email</v-icon> Email configuration
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex gap-2 align-center flex-wrap">
            <v-text-field
              v-model="mailAddress"
              label="Send test email to"
              density="compact"
              variant="outlined"
              hide-details
              class="mail-input"
            />
            <v-btn color="primary" :loading="busy" @click="sendTest">Send test email</v-btn>
          </div>
          <v-alert v-if="mailResult" :type="mailOk ? 'success' : 'error'" variant="tonal" density="compact" class="mt-3">
            {{ mailResult }}
          </v-alert>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel @group:selected="loadPhpInfo">
        <v-expansion-panel-title>
          <v-icon start>mdi-information-outline</v-icon> PHP Information
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <!-- phpinfo() output, produced server-side and shown verbatim. -->
          <div class="phpinfo" v-html="phpInfo" />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <PluginPrefsSection tab-id="prefSystem" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../../api/client';
import type { LogEntry } from '../../api/legacyEndpoints';
import { usePrefsNotifier } from './notify';
import PluginPrefsSection from './PluginPrefsSection.vue';

const notify = usePrefsNotifier();
const busy = ref(false);
// E_USER_WARNING; the handler treats any other value as "everything".
const severity = ref(512);
const severityOptions = [
  { value: 256, title: 'Errors' },
  { value: 512, title: 'Warnings' },
  { value: 1024, title: 'Everything' },
];

const logEnabled = ref(false);
const logEntries = ref<LogEntry[]>([]);
const logPage = ref(0);
const logTotalPages = ref(0);
const logLoaded = ref(false);

const mailAddress = ref('');
const mailResult = ref('');
const mailOk = ref(false);

const phpInfo = ref('');
const phpInfoLoaded = ref(false);

async function loadLog() {
  const response = await api.getEventLog({ page: logPage.value, severity: severity.value });
  logLoaded.value = true;
  if (response.status === 0) {
    logEntries.value = response.content.entries;
    logTotalPages.value = response.content.totalPages;
    logPage.value = response.content.page;
  } else {
    notify(response.error ?? 'Failed to load the event log', 'error');
  }
}

function gotoPage(page: number) {
  logPage.value = page;
  void loadLog();
}

async function clearLog() {
  const response = await api.clearEventLog();
  if (response.status === 0) {
    await loadLog();
    notify('Event log cleared', 'success');
  } else {
    notify(response.error ?? 'Failed to clear the log', 'error');
  }
}

async function sendTest() {
  busy.value = true;
  const response = await api.sendTestEmail(mailAddress.value);
  busy.value = false;
  if (response.status === 0) {
    mailOk.value = response.content.rc;
    mailResult.value = response.content.rc ? 'Email sent.' : response.content.error;
  } else {
    mailOk.value = false;
    mailResult.value = response.error ?? 'Failed to send test email';
  }
}

async function loadPhpInfo() {
  if (phpInfoLoaded.value) return;
  phpInfoLoaded.value = true;
  const response = await api.getPhpInfo();
  if (response.status === 0) phpInfo.value = response.content;
}

onMounted(async () => {
  // The event log only exists when logging is configured for SQL; probe once so
  // the panel is not shown empty when it would always be.
  const response = await api.getEventLog({ page: 0, severity: severity.value });
  if (response.status === 0) {
    logEnabled.value = true;
    logEntries.value = response.content.entries;
    logTotalPages.value = response.content.totalPages;
    logLoaded.value = true;
  }
});
</script>

<style scoped>
.severity-select {
  max-width: 160px;
}

.mail-input {
  max-width: 320px;
}

.log-message {
  white-space: pre-wrap;
  word-break: break-word;
}

.phpinfo :deep(table) {
  border-collapse: collapse;
}

.phpinfo :deep(td) {
  border: 1px solid #ddd;
  padding: 2px 6px;
  font-size: 0.8125rem;
}
</style>
