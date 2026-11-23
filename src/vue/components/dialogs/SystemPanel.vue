<template>
  <div>
    <v-tabs v-model="tab" color="primary" density="compact">
      <v-tab value="log">Event log</v-tab>
      <v-tab value="email">Email</v-tab>
      <v-tab value="tasks">Scheduled tasks</v-tab>
      <v-tab value="php">PHP information</v-tab>
    </v-tabs>

    <v-window v-model="tab" class="mt-3">
      <v-window-item value="log">
        <div class="d-flex align-center ga-2 mb-2">
          <v-select
            v-model="severity"
            :items="severityOptions"
            item-title="title"
            item-value="value"
            label="Severity"
            density="compact"
            hide-details
            style="max-width: 180px"
            @update:model-value="loadLog(0)"
          />
          <v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadLog(log.page)">
            Refresh
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :disabled="log.page <= 0"
            @click="loadLog(log.page - 1)"
          >
            Previous
          </v-btn>
          <span class="text-caption">Page {{ log.page + 1 }} of {{ log.pages }}</span>
          <v-btn
            size="small"
            variant="text"
            :disabled="log.page >= log.pages - 1"
            @click="loadLog(log.page + 1)"
          >
            Next
          </v-btn>
          <v-spacer />
          <v-btn size="small" color="error" variant="tonal" @click="clearLog">Clear</v-btn>
        </div>

        <div v-if="loadingLog" class="text-center py-4">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <v-table v-else density="compact" class="log-table">
          <thead>
            <tr>
              <th>Error</th>
              <th>File</th>
              <th>Message</th>
              <th>User</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in log.entries" :key="index">
              <td>{{ entry.errno_name }} ({{ entry.errno }})</td>
              <td>{{ entry.filename }}</td>
              <td>
                {{ entry.message }}
                <div v-if="entry.context" class="text-caption text-grey">{{ entry.context }}</div>
              </td>
              <td>{{ entry.login }}</td>
              <td>{{ entry.date }}</td>
            </tr>
            <tr v-if="log.entries.length === 0">
              <td colspan="5" class="text-center text-grey">No log entries.</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="email">
        <v-text-field v-model="email" label="To" type="email" density="compact" />
        <v-btn color="primary" :loading="busy" @click="sendEmail">Send test email</v-btn>
        <v-alert v-if="emailResult" :type="emailResult.ok ? 'success' : 'error'" variant="tonal" density="compact" class="mt-3">
          {{ emailResult.ok ? 'Email sent.' : emailResult.error }}
        </v-alert>
      </v-window-item>

      <v-window-item value="tasks">
        <div class="d-flex align-center mb-2">
          <v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadTasks">Refresh</v-btn>
        </div>
        <v-table density="compact" class="tasks-table">
          <thead>
            <tr>
              <th>Task name</th>
              <th>Schedule</th>
              <th>Last executed</th>
              <th>Duration (s)</th>
              <th>Return code</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in tasks" :key="task.task_name">
              <td :class="task.rc === 0 ? 'text-success' : 'text-error'">{{ task.task_name }}</td>
              <td>{{ task.schedule }}</td>
              <td>{{ task.last_run }}</td>
              <td>{{ task.duration }}</td>
              <td>{{ task.rc }}</td>
            </tr>
            <tr v-if="tasks.length === 0">
              <td colspan="5" class="text-center text-grey">No scheduled tasks.</td>
            </tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="php">
        <div class="d-flex align-center mb-2">
          <v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadPhpInfo">
            Load PHP information
          </v-btn>
        </div>
        <div class="phpinfo" v-html="sanitizedPhpInfo" />
      </v-window-item>
    </v-window>

    <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-3">
      {{ message }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import DOMPurify from 'dompurify';
import api from '../../api/client';
import type { ScheduledTask, SystemLog } from '../../api/legacyEndpoints';

const tab = ref('log');
const severity = ref(512);
const log = ref<SystemLog>({ entries: [], page: 0, pages: 1, total: 0, severity: 512 });
const loadingLog = ref(false);
const email = ref('');
const emailResult = ref<{ ok: boolean; error: string } | null>(null);
const tasks = ref<ScheduledTask[]>([]);
const phpInfo = ref('');
const busy = ref(false);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const severityOptions = [
  { title: 'Errors', value: 256 },
  { title: 'Warnings', value: 512 },
  { title: 'Everything', value: 1024 },
];

const sanitizedPhpInfo = computed(() => (phpInfo.value ? DOMPurify.sanitize(phpInfo.value) : ''));

onMounted(async () => {
  await Promise.all([loadLog(0), loadTasks()]);
});

function showMessage(text: string, type: 'success' | 'error' = 'success'): void {
  message.value = text;
  messageType.value = type;
}

async function loadLog(page: number): Promise<void> {
  loadingLog.value = true;
  try {
    const response = await api.getSystemLog(page, severity.value);
    if (response.status === 0) {
      log.value = response.content;
    } else {
      showMessage(response.error ?? 'Failed to load the event log', 'error');
    }
  } finally {
    loadingLog.value = false;
  }
}

async function clearLog(): Promise<void> {
  const response = await api.clearSystemLog();
  showMessage(response.status === 0 ? 'Event log cleared' : response.error ?? 'Failed to clear the log', response.status === 0 ? 'success' : 'error');
  await loadLog(0);
}

async function sendEmail(): Promise<void> {
  busy.value = true;
  try {
    const response = await api.sendTestEmail(email.value);
    if (response.status === 0) {
      emailResult.value = response.content;
    } else {
      emailResult.value = { ok: false, error: response.error ?? 'Failed to send the test email' };
    }
  } finally {
    busy.value = false;
  }
}

async function loadTasks(): Promise<void> {
  const response = await api.getScheduledTasks();
  if (response.status === 0) {
    tasks.value = response.content;
  } else {
    showMessage(response.error ?? 'Failed to load scheduled tasks', 'error');
  }
}

async function loadPhpInfo(): Promise<void> {
  const response = await api.getPhpInfo();
  if (response.status === 0) {
    phpInfo.value = response.content;
  } else {
    showMessage(response.error ?? 'Failed to load PHP information', 'error');
  }
}
</script>

<style scoped>
.log-table,
.tasks-table {
  max-height: 45vh;
  overflow-y: auto;
}

.phpinfo {
  max-height: 45vh;
  overflow-y: auto;
  font-size: 12px;
}
</style>
