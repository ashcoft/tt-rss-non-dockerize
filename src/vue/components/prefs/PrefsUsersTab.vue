<template>
  <div>
    <v-card variant="outlined" class="mb-4">
      <v-card-title class="text-subtitle-1">Users</v-card-title>
      <v-card-text>
        <div class="d-flex gap-2 mb-3 flex-wrap align-center">
          <v-text-field
            v-model="search"
            label="Search"
            density="compact"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-magnify"
            class="search-input"
            @keyup.enter="load"
          />
          <v-btn variant="tonal" @click="load">Search</v-btn>
          <v-btn color="primary" prepend-icon="mdi-account-plus" @click="addUser">Create user</v-btn>
        </div>

        <v-table density="compact">
          <thead>
            <tr>
              <th @click="sortBy('login')">Login</th>
              <th @click="sortBy('access_level')">Access level</th>
              <th @click="sortBy('num_feeds')">Subscribed feeds</th>
              <th @click="sortBy('created')">Registered</th>
              <th @click="sortBy('last_login')">Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td>
                <v-icon size="small" start>mdi-account</v-icon>
                <strong>{{ user.login }}</strong>
              </td>
              <td>{{ user.access_level_name }}</td>
              <td>{{ user.num_feeds }}</td>
              <td class="text-grey">{{ user.created }}</td>
              <td class="text-grey">{{ user.last_login }}</td>
              <td>
                <v-btn icon="mdi-pencil" size="small" variant="text" @click="editUser(user)" />
                <v-btn
                  icon="mdi-delete"
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="user.id === 1"
                  @click="removeUser(user)"
                />
              </td>
            </tr>
            <tr v-if="users.length === 0">
              <td colspan="6" class="text-grey text-center">No users found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <!-- User editor -->
    <v-dialog v-model="editorOpen" max-width="520">
      <v-card>
        <v-card-title>{{ userDraft.id ? 'Edit user' : 'Create user' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="userDraft.login" label="Login" density="compact" variant="outlined" />
          <v-select
            v-model="userDraft.access_level"
            :items="accessLevelItems"
            label="Access level"
            density="compact"
            variant="outlined"
          />
          <v-text-field v-model="userDraft.email" label="Email" density="compact" variant="outlined" />
          <v-checkbox v-model="userDraft.otp_enabled" label="Enable OTP" hide-details density="compact" />
          <v-text-field
            v-model="userDraft.password"
            :label="userDraft.id ? 'New password (optional)' : 'Password'"
            type="password"
            density="compact"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="editorOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="busy" @click="saveUser">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <PluginPrefsSection tab-id="prefUsers" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import api from '../../api/client';
import type { UserInfo } from '../../api/legacyEndpoints';
import { usePrefsNotifier } from './notify';
import PluginPrefsSection from './PluginPrefsSection.vue';

const notify = usePrefsNotifier();
const users = ref<UserInfo[]>([]);
const accessLevelNames = ref<Record<string, string>>({});
const search = ref('');
const sort = ref('login');
const busy = ref(false);

const editorOpen = ref(false);
const userDraft = ref({
  id: 0,
  login: '',
  access_level: 0,
  email: '',
  otp_enabled: false,
  password: '',
});

const accessLevelItems = computed(() =>
  Object.entries(accessLevelNames.value).map(([value, title]) => ({
    value: Number(value),
    title,
  }))
);

async function load() {
  const response = await api.getUsers({ search: search.value, sort: sort.value });
  if (response.status === 0) {
    users.value = response.content.users;
    accessLevelNames.value = response.content.accessLevelNames;
  } else {
    notify(response.error ?? 'Failed to load users', 'error');
  }
}

function sortBy(field: string) {
  sort.value = field;
  void load();
}

function editUser(user: UserInfo) {
  userDraft.value = {
    id: user.id,
    login: user.login,
    access_level: user.access_level,
    email: '',
    otp_enabled: false,
    password: '',
  };
  // Fetch the fields the list does not carry (email, otp).
  void loadDetails(user.id);
  editorOpen.value = true;
}

async function loadDetails(id: number) {
  const response = await api.getUserDetails(id);
  if (response.status === 0 && response.content) {
    userDraft.value = {
      ...userDraft.value,
      login: response.content.login,
      access_level: response.content.access_level,
      email: response.content.email,
      otp_enabled: response.content.otp_enabled,
    };
  }
}

function addUser() {
  userDraft.value = { id: 0, login: '', access_level: 0, email: '', otp_enabled: false, password: '' };
  editorOpen.value = true;
}

async function saveUser() {
  busy.value = true;
  const draft = userDraft.value;
  const response = draft.id
    ? await api.saveUser({
        id: draft.id,
        login: draft.login,
        access_level: draft.access_level,
        email: draft.email,
        otp_enabled: draft.otp_enabled,
        password: draft.password || undefined,
      })
    : await api.addUser(draft.login, draft.password, draft.access_level);
  busy.value = false;

  if (response.status === 0) {
    editorOpen.value = false;
    await load();
    notify('User saved', 'success');
  } else {
    notify(response.error ?? 'Failed to save user', 'error');
  }
}

async function removeUser(user: UserInfo) {
  const response = await api.removeUsers([user.id]);
  if (response.status === 0) {
    await load();
    notify('User removed', 'success');
  } else {
    notify(response.error ?? 'Failed to remove user', 'error');
  }
}

onMounted(load);
</script>

<style scoped>
.search-input {
  max-width: 260px;
}
</style>
