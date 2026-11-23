<template>
  <div>
    <div class="d-flex align-center ga-2 mb-3">
      <v-text-field
        v-model="search"
        label="Search users"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        hide-details
        clearable
        @update:model-value="loadUsers"
      />
      <v-select
        v-model="sort"
        :items="sortOptions"
        label="Sort"
        density="compact"
        hide-details
        style="max-width: 200px"
        @update:model-value="loadUsers"
      />
      <v-btn color="primary" size="small" prepend-icon="mdi-account-plus" @click="openCreate">
        Create user
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-delete"
        :disabled="selected.length === 0"
        @click="removeSelected"
      >
        Remove
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-lock-reset"
        :disabled="selected.length === 0"
        @click="resetSelected"
      >
        Reset password
      </v-btn>
    </div>

    <div v-if="loading" class="text-center py-6">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <v-list v-else density="compact" class="users-list">
      <v-list-item v-for="user in users" :key="user.id" @click="openEdit(user)">
        <template #prepend>
          <v-checkbox
            :model-value="selected.includes(user.id)"
            hide-details
            density="compact"
            @click.stop
            @update:model-value="(checked: boolean) => toggleSelected(user.id, checked)"
          />
        </template>
        <v-list-item-title>
          {{ user.login }}
          <span class="text-caption text-grey">({{ user.access_level_name }})</span>
        </v-list-item-title>
        <v-list-item-subtitle>
          {{ user.num_feeds }} feeds · registered {{ user.created }} · last login {{ user.last_login }}
        </v-list-item-subtitle>
        <template #append>
          <v-btn
            icon="mdi-information-outline"
            size="small"
            variant="text"
            title="User details"
            @click.stop="openDetails(user)"
          />
        </template>
      </v-list-item>
      <v-list-item v-if="users.length === 0">
        <v-list-item-title>No users match.</v-list-item-title>
      </v-list-item>
    </v-list>

    <v-alert v-if="message" :type="messageType" variant="tonal" density="compact" class="mt-3">
      {{ message }}
    </v-alert>

    <v-dialog v-model="editOpen" max-width="520">
      <v-card>
        <v-card-title>{{ editId ? 'Edit user' : 'Create user' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="editForm.login" label="Login" density="compact" />
          <v-select
            v-model="editForm.access_level"
            :items="accessLevelOptions"
            item-title="title"
            item-value="value"
            label="Access level"
            density="compact"
          />
          <v-text-field v-model="editForm.email" label="Email" density="compact" />
          <v-text-field v-model="editForm.full_name" label="Full name" density="compact" />
          <v-checkbox v-model="editForm.otp_enabled" label="OTP enabled" hide-details density="compact" />
          <v-text-field
            v-model="editForm.password"
            :label="editId ? 'New password (optional)' : 'Password'"
            type="password"
            autocomplete="new-password"
            density="compact"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="editOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="busy" @click="saveUser">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="detailsOpen" max-width="560">
      <v-card>
        <v-card-title>{{ details?.login ?? 'User details' }}</v-card-title>
        <v-card-text v-if="details">
          <p>Registered: {{ details.created }}</p>
          <p>Last login: {{ details.last_login }}</p>
          <p>Stored articles: {{ details.stored_articles }}</p>
          <p>Subscribed feeds: {{ details.feeds.length }}</p>
          <v-list density="compact" class="details-feeds">
            <v-list-item v-for="feed in details.feeds" :key="feed.id">
              <v-list-item-title>
                <a :href="feed.site_url" target="_blank" rel="noopener noreferrer">{{ feed.title }}</a>
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="detailsOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import api from '../../api/client';
import type { UserDetails, UserRow } from '../../api/legacyEndpoints';

const users = ref<UserRow[]>([]);
const accessLevelNames = ref<Record<string, string>>({});
const search = ref('');
const sort = ref('login');
const loading = ref(false);
const busy = ref(false);
const selected = ref<number[]>([]);
const message = ref('');
const messageType = ref<'success' | 'error'>('success');

const sortOptions = [
  { title: 'Login', value: 'login' },
  { title: 'Access level', value: 'access_level' },
  { title: 'Subscribed feeds', value: 'num_feeds' },
  { title: 'Registered', value: 'created' },
  { title: 'Last login', value: 'last_login' },
];

const accessLevelOptions = computed(() =>
  Object.entries(accessLevelNames.value)
    .map(([value, title]) => ({ value: Number(value), title }))
    .filter((option) => Number.isFinite(option.value) && option.value !== -1024)
    .sort((a, b) => a.value - b.value)
);

const editOpen = ref(false);
const editId = ref<number | null>(null);
const editForm = ref({
  login: '',
  access_level: 0,
  email: '',
  full_name: '',
  otp_enabled: false,
  password: '',
});

const detailsOpen = ref(false);
const details = ref<UserDetails | null>(null);

onMounted(loadUsers);

async function loadUsers(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.getUsers(search.value ?? '', sort.value);
    if (response.status === 0) {
      users.value = response.content.users;
      accessLevelNames.value = response.content.accessLevelNames;
      selected.value = selected.value.filter((id) => users.value.some((user) => user.id === id));
    } else {
      showMessage(response.error ?? 'Failed to load users', 'error');
    }
  } finally {
    loading.value = false;
  }
}

function showMessage(text: string, type: 'success' | 'error' = 'success'): void {
  message.value = text;
  messageType.value = type;
}

function toggleSelected(id: number, checked: boolean): void {
  const next = new Set(selected.value);
  if (checked) {
    next.add(id);
  } else {
    next.delete(id);
  }
  selected.value = [...next];
}

function openCreate(): void {
  editId.value = null;
  editForm.value = {
    login: '',
    access_level: 0,
    email: '',
    full_name: '',
    otp_enabled: false,
    password: '',
  };
  editOpen.value = true;
}

function openEdit(user: UserRow): void {
  editId.value = user.id;
  editForm.value = {
    login: user.login,
    access_level: user.access_level,
    email: user.email,
    full_name: user.full_name,
    otp_enabled: user.otp_enabled,
    password: '',
  };
  editOpen.value = true;
}

async function saveUser(): Promise<void> {
  busy.value = true;
  try {
    if (editId.value === null) {
      const response = await api.addUser(editForm.value.login);
      showMessage(response.content || response.error || 'User created', response.status === 0 ? 'success' : 'error');
    } else {
      const response = await api.saveUser({
        id: editId.value,
        login: editForm.value.login,
        access_level: editForm.value.access_level,
        email: editForm.value.email,
        full_name: editForm.value.full_name,
        otp_enabled: editForm.value.otp_enabled,
        password: editForm.value.password,
      });
      showMessage(response.status === 0 ? 'User saved' : response.error ?? 'Failed to save user', response.status === 0 ? 'success' : 'error');
    }
    editOpen.value = false;
    await loadUsers();
  } finally {
    busy.value = false;
  }
}

async function removeSelected(): Promise<void> {
  if (selected.value.length === 0) return;
  if (!window.confirm('Remove the selected users and all their feeds?')) return;
  busy.value = true;
  try {
    const response = await api.removeUsers(selected.value);
    showMessage(response.status === 0 ? 'Users removed' : response.error ?? 'Failed to remove users', response.status === 0 ? 'success' : 'error');
    selected.value = [];
    await loadUsers();
  } finally {
    busy.value = false;
  }
}

async function resetSelected(): Promise<void> {
  if (selected.value.length === 0) return;
  if (!window.confirm('Reset the passwords of the selected users?')) return;
  busy.value = true;
  try {
    for (const id of selected.value) {
      await api.resetUserPassword(id);
    }
    showMessage('Passwords reset', 'success');
  } finally {
    busy.value = false;
  }
}

async function openDetails(user: UserRow): Promise<void> {
  const response = await api.getUserDetails(user.id);
  if (response.status === 0 && response.content) {
    details.value = response.content;
    detailsOpen.value = true;
  } else {
    showMessage(response.error ?? 'Failed to load user details', 'error');
  }
}
</script>

<style scoped>
.users-list,
.details-feeds {
  max-height: 50vh;
  overflow-y: auto;
}
</style>
